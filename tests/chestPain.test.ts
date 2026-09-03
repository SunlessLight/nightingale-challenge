import { describe, expect, it } from "vitest";
import { buildTriageSummary, type AcquisitionContext } from "@/lib/escalations";
import { decideRisk, keywordRisk, needsClinician, type LlmRisk } from "@/lib/risk";

/**
 * Phase 6's "risk escalation" test, walked through as ONE conversation rather
 * than as isolated units.
 *
 * tests/risk.test.ts already proves the phrase table and the max() rule. What
 * this file adds is the JOURNEY — the same four turns that were run against
 * the deployed app on Sep 3, in order, checking that the verdict a patient
 * actually experiences is right at every step: before the model is called,
 * when the model disagrees, when the model is unreachable, and when the
 * follow-up message contains no emergency phrase at all.
 *
 * The turns below are copied verbatim from that live session, typos included.
 * A test that quietly fixes the patient's spelling is testing a patient who
 * does not exist.
 */

const TURNS = {
  opening: "I seem to have crushing chest pain, what do you know about this",
  withDetail:
    '"I have crushing chest pain and I take Advil 400mg twice a day, allergic to penicillin',
  followUp: "i'm not having the pain right now, it just happens sometimes randomly",
};

const llm = (level: "low" | "medium" | "high", confidence = 0.9): LlmRisk => ({
  level,
  reason: `model said ${level}`,
  confidence,
});

// ---------------------------------------------------------------------------
// Turn 1 — the verdict that exists BEFORE the model is consulted.
// ---------------------------------------------------------------------------

describe("turn 1 — chest pain is High before any network call happens", () => {
  it("flags high from the keyword layer alone", () => {
    // This is the value the patient route writes to the database at step 3,
    // before askClaudeIntake() is reached. If the process died on the next
    // line, this verdict would already be durable.
    const stored = decideRisk(TURNS.opening, null);
    expect(stored.level).toBe("high");
    expect(stored.provenance.source).toBe("keyword");
    expect(stored.provenance.keyword_matched).toBe("chest_pain");
    expect(stored.confidence).toBe(1);
  });

  it("offers a clinician immediately", () => {
    expect(needsClinician(decideRisk(TURNS.opening, null).level)).toBe(true);
  });

  it("survives the model being unreachable entirely", () => {
    // The 502 branch of both chat routes returns exactly this decision, so the
    // emergency banner still renders when Anthropic is down. The keyword layer
    // is not a fallback for the model; this is the situation it exists for.
    const onFailure = decideRisk(TURNS.opening, null);
    expect(onFailure.level).toBe("high");
    expect(onFailure.reason).toMatch(/cardiac emergency/i);
  });
});

// ---------------------------------------------------------------------------
// Turn 2 — the model disagrees. It loses. Invariant #2, in situ.
// ---------------------------------------------------------------------------

describe("turn 2 — a reassuring model cannot lower a chest-pain verdict", () => {
  it("stays High when the model returns low with high confidence", () => {
    const decision = decideRisk(TURNS.withDetail, llm("low", 0.97));
    expect(decision.level).toBe("high");
    expect(decision.provenance.source).toBe("keyword");
    expect(decision.provenance.deescalation_blocked).toBe(true);
    // Auditable, not merely asserted: the override is written to the row.
    expect(decision.provenance.llm_level).toBe("low");
    expect(decision.provenance.llm_confidence).toBe(0.97);
  });

  it("stays High when the model returns medium", () => {
    expect(decideRisk(TURNS.withDetail, llm("medium")).level).toBe("high");
  });

  it("still matches through the stray quote mark the patient typed", () => {
    // The message begins with an unmatched double quote. normalise() strips
    // punctuation before matching, which is why a slip of the keyboard cannot
    // disarm the safety net.
    expect(keywordRisk(TURNS.withDetail)?.level).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Turn 3 — the follow-up with NO emergency phrase in it. This is the turn the
// keyword layer cannot catch, and the one the model is allowed to catch.
// ---------------------------------------------------------------------------

describe("turn 3 — the model may escalate where the keyword layer is silent", () => {
  it("has no keyword hit at all", () => {
    // Measured, not assumed: "not having the pain right now" contains none of
    // the phrases. Left explicit so a future change to the phrase table that
    // starts matching this sentence shows up as a failing test, not a surprise.
    expect(keywordRisk(TURNS.followUp)).toBeNull();
  });

  it("comes back High because the model said so, and records that it did", () => {
    const decision = decideRisk(TURNS.followUp, llm("high", 0.8));
    expect(decision.level).toBe("high");
    expect(decision.provenance.source).toBe("llm");
    expect(decision.provenance.deescalation_blocked).toBe(false);
    expect(decision.confidence).toBe(0.8);
  });

  it("does not fall back to Low just because the phrase is gone", () => {
    // The realistic failure: a patient walks their own symptom back, the
    // keyword layer goes quiet, and the conversation gets marked routine. Here
    // the model carries the context the regex cannot see.
    expect(decideRisk(TURNS.followUp, llm("high")).level).not.toBe("low");
  });

  it("is Low only if the model ALSO sees nothing — and that is recorded as a default", () => {
    const decision = decideRisk(TURNS.followUp, llm("low"));
    expect(decision.level).toBe("low");
    expect(decision.provenance.source).toBe("default");
    expect(decision.provenance.deescalation_blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Turn 4 — the handoff a clinician receives at the end of that conversation.
// ---------------------------------------------------------------------------

describe("the escalation the chest-pain conversation produces", () => {
  const acquisition: AcquisitionContext = {
    clinic_id: "sunway-family-demo",
    source_channel: "instagram_dm",
    campaign_id: "sept_knee",
    creative: null,
    staff_referral_topic: null,
    landing_timestamp: "2026-09-03T03:07:22.000Z",
    lead_session_id: "f6da593e-da5a-4a17-aeed-692a7ed4e0c7",
    started_anonymous: true,
  };

  const decision = decideRisk(TURNS.followUp, llm("high", 0.8));

  const bullets = buildTriageSummary({
    risk: {
      level: decision.level,
      reason: decision.reason,
      source: decision.provenance.source,
      matched: decision.provenance.keyword_matched,
    },
    triggeringMessage: TURNS.followUp,
    profile: [
      { category: "chief_complaint", value: "Crushing chest pain", status: "active" },
      { category: "medication", value: "Advil (ibuprofen) 400mg twice daily", status: "active" },
      { category: "allergy", value: "Penicillin", status: "active" },
    ],
    acquisition,
  });

  it("tells the clinician it is HIGH RISK", () => {
    expect(bullets[0]).toContain("HIGH RISK");
  });

  it("says the AI made this call, not a phrase rule", () => {
    // Turn 3 was escalated by the model. A clinician should be told that,
    // because a deterministic rule and a model judgement deserve different
    // amounts of trust.
    expect(bullets[0]).toContain("AI assessment");
    expect(bullets[0]).not.toContain("emergency-phrase rule");
  });

  it("carries the allergy across, so the handoff is not just an alarm", () => {
    expect(bullets.join("\n")).toContain("Penicillin");
  });

  it("quotes the patient rather than paraphrasing the escalation", () => {
    expect(bullets.join("\n")).toContain(TURNS.followUp);
  });
});
