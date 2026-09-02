import { describe, expect, it } from "vitest";
import { redact, toRedactedTurns } from "@/lib/redaction";

/**
 * CLAUDE.md safety invariant #5. Also pre-pays the "redaction" test from
 * Phase 6's required eight.
 */
describe("redact()", () => {
  it("masks a hyphenated Malaysian NRIC", () => {
    const { redacted, found } = redact("my ic is 900101-14-5523");
    expect(redacted).toBe("my ic is [REDACTED_ID]");
    expect(found).toContain("id");
  });

  it("masks a Malaysian phone number in several written forms", () => {
    for (const raw of ["012-345 6789", "+60123456789", "0123456789"]) {
      const { redacted } = redact(`call me on ${raw} please`);
      expect(redacted).toBe("call me on [REDACTED_PHONE] please");
    }
  });

  it("masks an email address", () => {
    const { redacted, found } = redact("reach me at aisyah.k+clinic@example.com ok");
    expect(redacted).toBe("reach me at [REDACTED_EMAIL] ok");
    expect(found).toContain("email");
  });

  it("masks a self-introduced name without eating ordinary sentences", () => {
    expect(redact("Hi, my name is Jonathan Wong").redacted).toBe(
      "Hi, my name is [REDACTED_NAME]",
    );
    // "I'm" followed by a lowercase word is a feeling, not a name.
    expect(redact("I'm worried about this").redacted).toBe("I'm worried about this");
  });

  it("masks a known synthetic name anywhere in the sentence", () => {
    expect(redact("Tell Priya I called").redacted).toBe("Tell [REDACTED_NAME] I called");
  });

  /**
   * The ordering trap documented in src/lib/redaction.ts. An unhyphenated NRIC
   * that begins with 0 also satisfies the phone pattern; if the phone rule ran
   * first it would consume a 10-digit slice and mislabel a national ID.
   */
  it("classifies a bare 12-digit NRIC as an ID, not a phone number", () => {
    const { redacted, found } = redact("ic 010203145678");
    expect(redacted).toBe("ic [REDACTED_ID]");
    expect(found).toContain("id");
    expect(found).not.toContain("phone");
  });

  it("leaves clinically relevant numbers alone", () => {
    const raw = "the pain started 3 days ago and I am 42";
    expect(redact(raw).redacted).toBe(raw);
  });

  it("is idempotent — redacting twice changes nothing", () => {
    const once = redact("my name is Sarah, ic 900101-14-5523, hp 012-345 6789").redacted;
    expect(redact(once).redacted).toBe(once);
  });
});

describe("toRedactedTurns() — the only path from the DB to the model", () => {
  const RAW = "Hi, my name is Sarah, my ic is 900101-14-5523 and my number is 012-345 6789";

  it("carries no raw PII into the LLM payload", () => {
    const rows = [
      { role: "user", content: RAW, redacted_content: redact(RAW).redacted },
      { role: "assistant", content: "Thanks for sharing.", redacted_content: null },
    ];

    const payload = JSON.stringify(toRedactedTurns(rows));

    // Runtime proof, not a compile-time promise: the branded type is erased
    // at runtime, so assert on the actual bytes that would be sent.
    expect(payload).not.toContain("Sarah");
    expect(payload).not.toContain("900101-14-5523");
    expect(payload).not.toContain("012-345 6789");
    expect(payload).toContain("[REDACTED_NAME]");
    expect(payload).toContain("[REDACTED_ID]");
    expect(payload).toContain("[REDACTED_PHONE]");
  });

  it("scrubs a row that was stored WITHOUT a redacted_content, rather than leaking it", () => {
    // Defence in depth: a future code path that forgets to redact on write
    // still cannot leak, because this function re-redacts on read.
    const rows = [{ role: "user", content: RAW, redacted_content: null }];
    const payload = JSON.stringify(toRedactedTurns(rows));
    expect(payload).not.toContain("Sarah");
    expect(payload).not.toContain("900101-14-5523");
  });

  it("drops system rows so only user/assistant turns reach the model", () => {
    const rows = [
      { role: "system", content: "internal", redacted_content: "internal" },
      { role: "user", content: "hello", redacted_content: "hello" },
    ];
    expect(toRedactedTurns(rows)).toHaveLength(1);
  });
});
