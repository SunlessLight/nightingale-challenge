import { describe, expect, it } from "vitest";
import { decideRisk, keywordRisk, type LlmRisk } from "@/lib/risk";

/**
 * CLAUDE.md invariants #1, #2 and #4. These were written BEFORE the
 * implementation, deliberately: a missed emergency phrase is the one failure
 * in this build that an apology in the brief cannot recover.
 */

// ---------------------------------------------------------------------------
// Invariant #1 — the four phrases ALWAYS flag High.
// ---------------------------------------------------------------------------

const THE_FOUR = [
  "crushing chest pain",
  "difficulty breathing",
  "heavy bleeding",
  "want to hurt myself",
];

describe("invariant #1 — the four named phrases", () => {
  it.each(THE_FOUR)("flags high: %s", (phrase) => {
    expect(keywordRisk(phrase)?.level).toBe("high");
  });

  it.each(THE_FOUR)("flags high inside a longer sentence: %s", (phrase) => {
    const hit = keywordRisk(`hi, since this morning i have had ${phrase} and i am scared`);
    expect(hit?.level).toBe("high");
  });

  it.each(THE_FOUR)("flags high regardless of case and punctuation: %s", (phrase) => {
    const shouty = phrase.toUpperCase().split(" ").join(", ") + "!!!";
    expect(keywordRisk(shouty)?.level).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Close variants. This is the list that actually protects someone, because
// almost nobody types the canonical phrase.
// ---------------------------------------------------------------------------

const CLOSE_VARIANTS = [
  // chest
  "my chest hurts really badly",
  "severe chest pain",
  "crushing pain in my chest",
  "there is pressure on my chest",
  "it feels like an elephant is sitting on my chest",
  "chest pain going down my left arm",
  // breathing
  "i cant breathe",
  "i can't breathe properly",
  "having trouble breathing",
  "it is hard to breathe",
  "i am short of breath",
  "shortness of breath when i walk",
  "gasping for air",
  "struggling to breathe",
  // bleeding
  "i am bleeding heavily",
  "bleeding a lot and it wont stop",
  "the bleeding will not stop",
  "soaking through a pad every hour",
  "there is a lot of blood",
  // self-harm
  "i want to kill myself",
  "i wanna hurt myself",
  "i have been thinking about ending my life",
  "i feel suicidal",
  "everyone would be better off without me",
  "i dont want to be here anymore",
  "i have been harming myself",
];

describe("invariant #1 — close variants also flag high", () => {
  it.each(CLOSE_VARIANTS)("flags high: %s", (text) => {
    expect(keywordRisk(text)?.level).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Invariant #4 — ambiguous symptoms escalate rather than reassure.
// ---------------------------------------------------------------------------

const AMBIGUOUS = [
  "my chest feels funny",
  "my chest feels a bit weird today",
  "i keep feeling dizzy",
  "i felt lightheaded this morning",
  "my left arm has gone numb",
  "my heart is racing",
  "i fainted yesterday",
  "i passed out at work",
];

describe("invariant #4 — ambiguous symptoms never come back low", () => {
  it.each(AMBIGUOUS)("is at least medium: %s", (text) => {
    const hit = keywordRisk(text);
    expect(hit).not.toBeNull();
    expect(hit?.level === "medium" || hit?.level === "high").toBe(true);
  });
});

describe("ordinary messages are not over-flagged", () => {
  it.each([
    "hi, do you have appointments on saturday",
    "how much does a health screening cost",
    "i have had a mild sore throat for two days",
    "can i get my vaccination record",
    "my knee aches a bit after running",
  ])("returns no keyword hit: %s", (text) => {
    expect(keywordRisk(text)).toBeNull();
  });
});

describe("deliberately NOT clever about negation or third parties", () => {
  // Documented decision, not an oversight. A false positive costs one
  // unnecessary "please call 999". A false negative can cost a life, and
  // "I don't have chest pain" vs "I don't *think* it's chest pain" is not a
  // distinction worth betting someone's life on a regex getting right.
  it("still flags a negated emergency phrase", () => {
    expect(keywordRisk("i dont think this is crushing chest pain")?.level).toBe("high");
  });

  it("still flags an emergency phrase about someone else", () => {
    expect(keywordRisk("my mother had heavy bleeding last year")?.level).toBe("high");
  });
});

describe("the keyword layer sees through redaction tokens", () => {
  it("flags a phrase sitting next to a redacted name", () => {
    const hit = keywordRisk("hi im [REDACTED_NAME] and i have difficulty breathing");
    expect(hit?.level).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Invariant #2 — THE load-bearing one. The LLM may escalate. It may never
// de-escalate a keyword hit.
// ---------------------------------------------------------------------------

const llm = (level: "low" | "medium" | "high", confidence = 0.9): LlmRisk => ({
  level,
  reason: `model said ${level}`,
  confidence,
});

describe("invariant #2 — the LLM may escalate but never de-escalate", () => {
  it("keeps HIGH when the model says low", () => {
    const decision = decideRisk("crushing chest pain", llm("low"));
    expect(decision.level).toBe("high");
    expect(decision.provenance.source).toBe("keyword");
    expect(decision.provenance.deescalation_blocked).toBe(true);
  });

  it("keeps HIGH when the model says medium", () => {
    const decision = decideRisk("i cant breathe", llm("medium"));
    expect(decision.level).toBe("high");
    expect(decision.provenance.deescalation_blocked).toBe(true);
  });

  it("keeps MEDIUM when the model says low on an ambiguous symptom", () => {
    const decision = decideRisk("my chest feels funny", llm("low"));
    expect(decision.level).toBe("medium");
    expect(decision.provenance.deescalation_blocked).toBe(true);
  });

  it("ALLOWS the model to escalate above the keyword layer", () => {
    const decision = decideRisk("i have a rash that is spreading fast", llm("high"));
    expect(decision.level).toBe("high");
    expect(decision.provenance.source).toBe("llm");
    expect(decision.provenance.deescalation_blocked).toBe(false);
  });

  it("allows the model to escalate low to medium", () => {
    const decision = decideRisk("i feel generally unwell", llm("medium"));
    expect(decision.level).toBe("medium");
    expect(decision.provenance.source).toBe("llm");
  });

  it("still flags high when the model call FAILED entirely", () => {
    // The keyword layer is not a fallback for the model. It is a guarantee
    // that outranks it, so it must hold when the model returns nothing.
    const decision = decideRisk("heavy bleeding", null);
    expect(decision.level).toBe("high");
    expect(decision.provenance.source).toBe("keyword");
  });

  it("defaults to low only when BOTH layers are silent", () => {
    const decision = decideRisk("do you open on saturday", null);
    expect(decision.level).toBe("low");
    expect(decision.provenance.source).toBe("default");
  });

  it("never lets a high-confidence model reassurance win", () => {
    // The realistic refactor this guards: "the model is 99% sure it's fine,
    // trust it." Confidence is not authority.
    const decision = decideRisk("i want to hurt myself", llm("low", 0.99));
    expect(decision.level).toBe("high");
  });
});

describe("risk_provenance records which layer decided", () => {
  it("records the keyword rule that fired", () => {
    const decision = decideRisk("crushing chest pain", llm("low"));
    expect(decision.provenance.keyword_level).toBe("high");
    expect(decision.provenance.keyword_matched).toBeTruthy();
    expect(decision.provenance.llm_level).toBe("low");
    expect(typeof decision.provenance.at).toBe("string");
  });

  it("reports full confidence for a deterministic keyword decision", () => {
    expect(decideRisk("heavy bleeding", llm("low", 0.2)).confidence).toBe(1);
  });

  it("carries the model's own confidence when the model decided", () => {
    expect(decideRisk("i feel unwell", llm("medium", 0.62)).confidence).toBe(0.62);
  });

  it("gives a human-readable reason in every case", () => {
    for (const text of ["crushing chest pain", "my chest feels funny", "hello there"]) {
      expect(decideRisk(text, null).reason.length).toBeGreaterThan(0);
    }
  });
});
