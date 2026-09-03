import { describe, expect, it } from "vitest";
import { GUEST_SYSTEM_PROMPT, intakeSystemPrompt } from "@/lib/prompts";

/**
 * Phase 6's "are you a real doctor?" honesty test — CLAUDE.md invariant #3.
 *
 * BE HONEST ABOUT WHAT THIS PROVES. It proves the instruction is present in
 * the exact string both live routes send, on both surfaces, and that a future
 * edit cannot quietly delete it. It does NOT prove the model obeys — nothing
 * offline can prove that. Obedience was checked by hand against the deployed
 * app, and the layer that does not depend on obedience is the keyword net in
 * risk.ts, which is tested separately in tests/risk.test.ts.
 *
 * Both prompts are asserted together, every time. The guest surface is the one
 * a stranger meets first and the one most likely to be "simplified" later,
 * which is exactly how a disclosure goes missing on half a product.
 */

const SURFACES: [name: string, prompt: string][] = [
  ["guest chat", GUEST_SYSTEM_PROMPT],
  ["patient intake", intakeSystemPrompt("")],
];

describe.each(SURFACES)("%s — the AI never claims to be a clinician", (_name, prompt) => {
  it("states plainly that it is an AI and not a doctor", () => {
    expect(prompt).toContain("You are an AI, not a doctor");
  });

  it("is told what to say when asked directly whether it is a real doctor", () => {
    // The literal question a nervous person asks. If the prompt only said
    // "you are an AI" the model could still answer the direct question badly,
    // so the instruction names the question itself.
    expect(prompt).toMatch(/asked whether you are a real doctor/i);
    expect(prompt).toMatch(/say plainly that you are not/i);
  });

  it("points the person at a real clinician rather than ending the thought there", () => {
    // "I am not a doctor" alone is a dead end. The honest answer includes the
    // route to a human, which is the entire product.
    expect(prompt).toMatch(/real clinician can pick this up/i);
  });
});

describe.each(SURFACES)("%s — non-diagnostic, invariant #3", (_name, prompt) => {
  it("forbids diagnosis in the model's own words", () => {
    expect(prompt).toContain("NEVER diagnose");
    expect(prompt).toContain('"you have X"');
  });

  it("forbids medication and dose changes", () => {
    expect(prompt).toMatch(/NEVER recommend starting, stopping or changing a medication or a dose/);
  });
});

describe.each(SURFACES)("%s — no false reassurance, invariant #4", (_name, prompt) => {
  it("requires honest uncertainty rather than comfort", () => {
    expect(prompt).toMatch(/say honestly that you are not sure/i);
    expect(prompt).toMatch(/Never offer false reassurance/i);
  });

  it("names the four emergency categories and the 999 instruction", () => {
    for (const phrase of [
      "chest pain",
      "trouble breathing",
      "heavy bleeding",
      "harming themselves",
      "call 999 now",
    ]) {
      expect(prompt).toContain(phrase);
    }
  });
});

describe.each(SURFACES)("%s — redaction is explained, not worked around", (_name, prompt) => {
  it("tells the model the tokens are intentional and must not be re-asked", () => {
    // Without this the model helpfully asks "sorry, what was your name?" and
    // walks the patient straight back into re-identifying themselves.
    expect(prompt).toContain("[REDACTED_NAME]");
    expect(prompt).toMatch(/Never ask the person to repeat them/i);
    expect(prompt).toMatch(/never ask for a full name, IC number, phone number or address/i);
  });
});

describe("the intake prompt's load-bearing extras", () => {
  const prompt = intakeSystemPrompt("");

  it("keeps the character-for-character value contract", () => {
    // CLAUDE.md calls this paragraph load-bearing: it is the only thing
    // stopping the living-memory soft join from writing a profile that says a
    // patient is both taking and not taking the same drug. Measured failing in
    // Phase 4 before this paragraph existed.
    expect(prompt).toContain("CHARACTER FOR CHARACTER");
    expect(prompt).toMatch(/do NOT append words like "stopped"/);
  });

  it("tells the model to emit a stopped medication rather than dropping it", () => {
    expect(prompt).toMatch(/emit it with status 'stopped' rather than dropping it/);
  });

  it("says an emergency interrupts the intake rather than waiting for it to finish", () => {
    expect(prompt).toMatch(/even if it interrupts the intake/i);
    expect(prompt).toMatch(/Finishing the form is never the priority/i);
  });
});

describe("the profile context is appended, never prepended", () => {
  it("puts the patient's facts after the hard rules", () => {
    // A long profile must not push the safety rules out of the model's
    // attention, so the rules go first and the facts go last.
    const withProfile = intakeSystemPrompt("WHAT THIS PATIENT HAS ALREADY TOLD US:\n- [allergy] Penicillin (active)");
    expect(withProfile.indexOf("NEVER diagnose")).toBeLessThan(
      withProfile.indexOf("WHAT THIS PATIENT HAS ALREADY TOLD US"),
    );
  });

  it("omits the section entirely when there is nothing on file", () => {
    expect(intakeSystemPrompt("")).toBe(intakeSystemPrompt("").trimEnd());
    expect(intakeSystemPrompt("")).not.toContain("WHAT THIS PATIENT HAS ALREADY TOLD US");
  });
});
