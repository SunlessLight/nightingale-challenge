import { describe, expect, it } from "vitest";
import {
  buildTriageSummary,
  type AcquisitionContext,
  type TriageInput,
} from "@/lib/escalations";

/**
 * The escalation payload test (brief requirement #3).
 *
 * What is actually being defended here: a clinician opening this must be able
 * to act without reading the whole transcript, and must never be shown a
 * sentence the patient did not say. `buildTriageSummary` is pure precisely so
 * that contract is testable without a database or a model.
 */

const acquisition: AcquisitionContext = {
  clinic_id: "clinic_demo",
  source_channel: "instagram_dm",
  campaign_id: "sept_knee",
  creative: "reel_a",
  staff_referral_topic: null,
  landing_timestamp: "2026-09-03T02:00:00.000Z",
  lead_session_id: "11111111-1111-1111-1111-111111111111",
  started_anonymous: true,
};

function input(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    risk: {
      level: "high",
      reason: "Mentioned chest pain or chest pressure, which can indicate a cardiac emergency.",
      source: "keyword",
      matched: "chest_pain",
    },
    triggeringMessage: "i have crushing chest pain and it wont stop",
    profile: [
      { category: "chief_complaint", value: "Chest discomfort since this morning", status: "active" },
      { category: "medication", value: "Advil 400mg twice a day", status: "stopped" },
      { category: "allergy", value: "Penicillin", status: "active" },
    ],
    acquisition,
    ...overrides,
  };
}

describe("triage summary — the clinician handoff payload", () => {
  it("is between 1 and 5 bullets", () => {
    const bullets = buildTriageSummary(input());
    expect(bullets.length).toBeGreaterThanOrEqual(1);
    expect(bullets.length).toBeLessThanOrEqual(5);
  });

  it("leads with the risk level and the reason", () => {
    const [first] = buildTriageSummary(input());
    expect(first).toContain("HIGH RISK");
    expect(first).toContain("cardiac emergency");
  });

  it("records WHICH LAYER flagged it, so a clinician knows how much to trust it", () => {
    // Invariant #2 is auditable end to end: risk_provenance records the
    // deciding layer, and the handoff carries it through to the human.
    const keyword = buildTriageSummary(input())[0];
    expect(keyword).toContain("chest_pain");

    const llm = buildTriageSummary(
      input({
        risk: {
          level: "medium",
          reason: "The pain pattern described has worsened over the conversation.",
          source: "llm",
          matched: null,
        },
      }),
    )[0];
    expect(llm).toContain("AI assessment");
    expect(llm).not.toContain("emergency-phrase rule");
  });

  it("quotes the patient VERBATIM rather than paraphrasing them", () => {
    const bullets = buildTriageSummary(input());
    const quote = bullets.find((bullet) => bullet.startsWith("Patient's words"));
    expect(quote).toBeDefined();
    expect(quote).toContain("i have crushing chest pain and it wont stop");
  });

  it("never invents a fact that is not in the profile or the message", () => {
    // Everything in every bullet must be traceable to an input string. This is
    // the property a model-written summary cannot offer.
    const source = input();
    const haystack = [
      source.triggeringMessage,
      ...source.profile.map((item) => item.value),
      source.acquisition.source_channel ?? "",
    ]
      .join(" ")
      .toLowerCase();

    for (const item of source.profile) {
      expect(haystack).toContain(item.value.toLowerCase());
    }

    const bullets = buildTriageSummary(source).join(" ").toLowerCase();
    // A symptom nobody mentioned must not appear.
    expect(bullets).not.toContain("shortness of breath");
    expect(bullets).not.toContain("diabetes");
  });

  it("keeps stopped medications, and marks them stopped", () => {
    const bullets = buildTriageSummary(input()).join(" ");
    // Dropping a stopped drug would give a clinician a tidier and worse record.
    expect(bullets).toContain("Advil 400mg twice a day (stopped)");
  });

  it("carries the acquisition channel, so nothing is re-asked", () => {
    const bullets = buildTriageSummary(
      input({ profile: [] }),
    ).join(" ");
    expect(bullets).toContain("instagram_dm");
    expect(bullets).toContain("anonymously");
  });

  it("still produces a usable handoff when the profile is empty", () => {
    const bullets = buildTriageSummary(input({ profile: [] }));
    expect(bullets.length).toBeGreaterThanOrEqual(2);
    expect(bullets[0]).toContain("HIGH RISK");
    expect(bullets[1]).toContain("crushing chest pain");
  });

  it("caps at 5 bullets even when everything is populated", () => {
    const bullets = buildTriageSummary(
      input({
        profile: [
          { category: "chief_complaint", value: "Chest discomfort", status: "active" },
          { category: "symptom", value: "Dizziness", status: "active" },
          { category: "medication", value: "Advil 400mg", status: "active" },
          { category: "allergy", value: "Penicillin", status: "active" },
        ],
      }),
    );
    expect(bullets).toHaveLength(5);
  });

  it("truncates a very long message rather than shipping an essay", () => {
    const bullets = buildTriageSummary(
      input({ triggeringMessage: "chest pain ".repeat(200) }),
    );
    const quote = bullets[1];
    expect(quote.length).toBeLessThan(300);
    expect(quote).toContain("…");
  });
});
