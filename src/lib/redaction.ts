/**
 * Redaction — CLAUDE.md safety invariant #5.
 *
 * "Redaction runs before ANY text reaches the LLM. Store both `content` and
 * `redacted_content`; only the redacted form leaves our server."
 *
 * A comment saying "remember to redact" is exactly the kind of thing a later
 * refactor deletes. So the guarantee is made STRUCTURAL instead:
 * `redact()` returns a branded `Redacted` string, and `askClaude()` accepts
 * only `Redacted`. Handing it a raw `content` string is a TypeScript compile
 * error, not something a reviewer has to notice.
 *
 * Honest limitation (also stated in the README): a branded type is erased at
 * runtime — it is a compile-time guarantee only. `tests/redaction.test.ts`
 * backs it with a runtime assertion that the exact payload the chat route
 * hands to the model contains none of the raw PII from the input.
 */

declare const redactedBrand: unique symbol;

/**
 * A string that has been through `redact()`. The brand cannot be forged from
 * outside this module, so the only way to obtain one is to redact.
 */
export type Redacted = string & { readonly [redactedBrand]: "redacted" };

export type RedactionKind = "email" | "id" | "phone" | "name";

export type Turn = { role: "user" | "assistant"; content: Redacted };

/**
 * Synthetic demo names. Capitalisation is required deliberately: a
 * case-insensitive `\btan\b` would also redact "tan lines". Proper nouns are
 * capitalised, and over-redacting the whole English language would make the
 * demo unreadable while adding no real safety.
 *
 * SYNTHETIC DATA ONLY (invariant #8) — no real person appears in this list.
 */
export const SYNTHETIC_NAMES = [
  "Aisyah", "Siti", "Nurul", "Rahman", "Farah",
  "Wei Ming", "Mei Ling", "Priya", "Kumar", "Devi",
  "Evan", "Sarah", "Daniel",
] as const;

type Replacement = string | ((match: string, ...groups: string[]) => string);
type Rule = { kind: RedactionKind; pattern: RegExp; replacement: Replacement };

/**
 * ORDER IS LOAD-BEARING. Do not reorder without reading this.
 *
 * 1. EMAIL first — an address is unambiguous, and redacting it first stops the
 *    digit rules from chewing a hole in the middle of one.
 * 2. ID before PHONE — an unhyphenated 12-digit Malaysian NRIC beginning with
 *    a `0` (anyone born in the 2000s, e.g. 010203145678) ALSO satisfies the
 *    phone pattern. If phone ran first it would eat a 10-digit slice and
 *    mislabel a national ID number as a phone number. `tests/redaction.test.ts`
 *    pins this ordering with that exact case.
 * 3. NAME last — it works on words, not digits, so it is order-independent.
 */
const RULES: Rule[] = [
  {
    kind: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    kind: "id",
    // Malaysian NRIC: YYMMDD-PB-###G, hyphenated or bare.
    pattern: /\b\d{6}-\d{2}-\d{4}\b|\b\d{12}\b/g,
    replacement: "[REDACTED_ID]",
  },
  {
    kind: "phone",
    // Malaysian mobile/landline: +60..., 60..., or 0... with optional
    // spaces/hyphens. Anchored on the leading +60 / 0 so it does not swallow
    // ordinary numbers like "for 3 days" or "since 2019".
    pattern: /(?:\+?6?0)[\s-]?\d{1,2}[\s-]?\d{3,4}[\s-]?\d{4}\b/g,
    replacement: "[REDACTED_PHONE]",
  },
  {
    kind: "name",
    // Self-introductions. The prefix alternatives spell out both cases rather
    // than using the /i flag, because /i would also lowercase-match the NAME
    // group and turn "I'm worried" into "I'm [REDACTED_NAME]".
    pattern:
      /((?:[Mm]y name is|[Ii]'m|[Ii] am|[Tt]his is|[Cc]all me)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    replacement: "$1[REDACTED_NAME]",
  },
  {
    kind: "name",
    // String.raw so the word boundaries stay `\b` and are not read as the
    // JavaScript backspace escape — a silent failure that makes the regex
    // match nothing at all rather than erroring.
    pattern: new RegExp(String.raw`\b(?:${SYNTHETIC_NAMES.join("|")})\b`, "g"),
    replacement: "[REDACTED_NAME]",
  },
];

/**
 * Strip direct identifiers from free text.
 *
 * Detection works by comparing the string before and after each replace rather
 * than calling `pattern.test()`. A `/g` regex carries a mutable `lastIndex`, so
 * repeated `.test()` calls on the same object silently skip matches — a real
 * bug class that would make redaction intermittent. String comparison has no
 * such state.
 */
export function redact(raw: string): { redacted: Redacted; found: RedactionKind[] } {
  let text = raw;
  const found = new Set<RedactionKind>();

  for (const rule of RULES) {
    const before = text;
    text = text.replace(rule.pattern, rule.replacement as string);
    if (text !== before) found.add(rule.kind);
  }

  return { redacted: text as Redacted, found: [...found] };
}

/**
 * Build the LLM conversation payload from stored message rows.
 *
 * This is the ONLY path from the database to the model, and it is the place
 * invariant #5 is actually enforced at runtime:
 *
 *  - it reads `redacted_content`, never `content`;
 *  - it re-runs `redact()` on the way past. That is idempotent on already
 *    masked text, and it means a row written before this module existed — or
 *    by a future code path that forgot — still gets scrubbed here. It is also
 *    the only way to legitimately mint the `Redacted` brand from a plain
 *    database string, so there is no "trust me" escape hatch to misuse.
 */
export function toRedactedTurns(
  rows: { role: string; content: string; redacted_content: string | null }[],
): Turn[] {
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      role: row.role as "user" | "assistant",
      content: redact(row.redacted_content ?? row.content).redacted,
    }));
}
