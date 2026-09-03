import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_CHARS, validateConversion } from "@/lib/patientSessions";

/**
 * Phase 6's "guest -> patient conversion" test.
 *
 * These cover the CONSENT GATE, which is the part a UI change can silently
 * break: the submit button being disabled is a courtesy, this is the control.
 * The carry-over itself is exercised end to end against the real database
 * (see timeline.md, Phase 3 verification) because it is a SQL UPDATE, not
 * logic that can be unit tested honestly.
 */

const VALID = {
  leadSessionId: "11111111-2222-3333-4444-555555555555",
  email: "Guest@Nightingale.Test",
  password: "correct-horse",
  consent: true,
};

describe("conversion consent gate", () => {
  it("accepts a fully consented request", () => {
    const result = validateConversion(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Normalised, so the same human cannot become two accounts by
      // capitalising differently.
      expect(result.value.email).toBe("guest@nightingale.test");
      expect(result.value.marketingConsent).toBe(false);
    }
  });

  it("refuses when consent is absent", () => {
    const result = validateConversion({ ...VALID, consent: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  it("refuses when consent is false", () => {
    const result = validateConversion({ ...VALID, consent: false });
    expect(result.ok).toBe(false);
  });

  it.each([["true"], [1], ["on"], [{}]])(
    "refuses truthy non-boolean consent: %s",
    (consent) => {
      // A checkbox serialised as the STRING "true", or a 1 from a form
      // library, must not read as a person agreeing to share medical
      // information. Only the literal boolean counts.
      const result = validateConversion({ ...VALID, consent });
      expect(result.ok).toBe(false);
    },
  );

  it("keeps marketing consent separate from care consent", () => {
    const careOnly = validateConversion(VALID);
    const both = validateConversion({ ...VALID, marketingConsent: true });
    expect(careOnly.ok && careOnly.value.marketingConsent).toBe(false);
    expect(both.ok && both.value.marketingConsent).toBe(true);
  });

  it("does not accept marketing consent as care consent", () => {
    const result = validateConversion({ ...VALID, consent: false, marketingConsent: true });
    expect(result.ok).toBe(false);
  });
});

describe("conversion input validation", () => {
  it("rejects a lead session id that is not a uuid", () => {
    for (const leadSessionId of ["", "abc", "../../etc/passwd", "1111-2222"]) {
      const result = validateConversion({ ...VALID, leadSessionId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    }
  });

  it("rejects an obviously invalid email", () => {
    for (const email of ["", "nope", "a@b", "a b@c.com"]) {
      expect(validateConversion({ ...VALID, email }).ok).toBe(false);
    }
  });

  it(`rejects a password under ${MIN_PASSWORD_CHARS} characters`, () => {
    const result = validateConversion({ ...VALID, password: "a".repeat(MIN_PASSWORD_CHARS - 1) });
    expect(result.ok).toBe(false);
    const ok = validateConversion({ ...VALID, password: "a".repeat(MIN_PASSWORD_CHARS) });
    expect(ok.ok).toBe(true);
  });

  it("never leaks the password back in an error message", () => {
    const result = validateConversion({ ...VALID, password: "hunter2", email: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("hunter2");
  });
});
