/**
 * Risk gating — CLAUDE.md invariants #1, #2 and #4.
 *
 * TWO LAYERS, AND THE ORDER OF AUTHORITY BETWEEN THEM IS THE POINT.
 *
 *   1. `keywordRisk()` is deterministic, offline, and cannot fail. It does not
 *      call anything, so it still fires when Anthropic is down, when the key
 *      is wrong, when the model is rate limited, and when the model is simply
 *      wrong.
 *   2. The LLM layer is smarter and sees context the regex cannot.
 *
 * `decideRisk()` takes the HIGHER of the two, always. The model may escalate.
 * It may never de-escalate a keyword hit — not with high confidence, not with
 * a good argument, not ever. This is not the keyword layer being a *fallback*
 * for the model; it is a floor the model is not allowed under.
 *
 * The refactor this file exists to stop is "the model is smarter, let it
 * decide". If you are reading this while doing that: the tests in
 * tests/risk.test.ts will go red, and they are right and you are wrong.
 */

export type RiskLevel = "low" | "medium" | "high";

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export type KeywordHit = {
  level: Exclude<RiskLevel, "low">;
  /** The rule id that fired — stored in risk_provenance, so it is auditable. */
  matched: string;
  reason: string;
};

type Rule = {
  id: string;
  level: Exclude<RiskLevel, "low">;
  reason: string;
  pattern: RegExp;
};

/**
 * Normalise before matching, so "CHEST, PAIN!!!" and "chest pain" are the
 * same input. Apostrophes are kept (and smart quotes folded onto the plain
 * one) because "can't breathe" and "cant breathe" are both extremely common
 * and both must match.
 */
function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ONE TABLE, ordered high-severity first — the same shape as channels.ts, and
 * for the same reason: scattered conditionals are where a safety rule quietly
 * stops running. Adding a phrase means adding a row, never editing control flow.
 *
 * `\s+` between words rather than a literal space, because normalise() has
 * already collapsed whitespace but the source phrases stay readable this way.
 */
const RULES: Rule[] = [
  // --- 1. Cardiac / chest -------------------------------------------------
  {
    id: "chest_pain",
    level: "high",
    reason: "Mentioned chest pain or chest pressure, which can indicate a cardiac emergency.",
    pattern:
      /\b(crushing\s+chest\s+pain|chest\s+pain|pain\s+in\s+(my|the)\s+chest|chest\s+hurt(s|ing)?|crushing\s+pain|chest\s+(is\s+)?(crushing|tight)|tightness\s+in\s+(my|the)\s+chest|pressure\s+(on|in)\s+(my|the)\s+chest|elephant\s+.{0,20}\bchest)\b/,
  },
  {
    id: "cardiac_radiation",
    level: "high",
    reason: "Described pain radiating from the chest, a classic cardiac warning sign.",
    pattern: /\bchest\s+pain\s+(going|radiating|shooting|spreading)\b/,
  },

  // --- 2. Breathing -------------------------------------------------------
  {
    id: "breathing",
    level: "high",
    reason: "Reported difficulty breathing, which can deteriorate quickly.",
    pattern:
      /\b(difficulty\s+breathing|trouble\s+breathing|can'?t\s+breathe|cannot\s+breathe|hard\s+to\s+breathe|struggling\s+to\s+breathe|short(ness)?\s+of\s+breath|gasping\s+for\s+air|unable\s+to\s+breathe|breathless)\b/,
  },

  // --- 3. Bleeding --------------------------------------------------------
  {
    id: "bleeding",
    level: "high",
    reason: "Reported heavy or uncontrolled bleeding.",
    pattern:
      /\b(heavy\s+bleeding|bleeding\s+heavily|bleeding\s+a\s+lot|lot\s+of\s+blood|lots\s+of\s+blood|bleeding\s+(that\s+)?(wo|will)\s*n'?o?t\s+stop|bleeding\s+and\s+it\s+(wo|will)\s*n'?o?t\s+stop|h(a)?emorrhag(e|ing)|soaking\s+through)\b/,
  },

  // --- 4. Self-harm and suicidality ---------------------------------------
  // Broad on purpose. This is the rule where being over-inclusive costs an
  // awkward message and being under-inclusive costs everything.
  {
    id: "self_harm",
    level: "high",
    reason: "Expressed thoughts of self-harm or suicide.",
    pattern:
      /\b(want\s+to\s+hurt\s+myself|wanna\s+hurt\s+myself|hurt(ing)?\s+myself|harm(ing)?\s+myself|self\s*harm|want\s+to\s+kill\s+myself|kill\s+myself|end\s+my\s+life|ending\s+my\s+life|take\s+my\s+own\s+life|suicid(e|al)|better\s+off\s+(without\s+me|dead)|do\s*n'?o?t\s+want\s+to\s+be\s+here\s+anymore|do\s*n'?o?t\s+want\s+to\s+live)\b/,
  },

  // --- 5. Ambiguous — invariant #4 ----------------------------------------
  // These do NOT clear someone. "Chest feels funny" is exactly the phrasing a
  // person uses when they are minimising something serious, so it escalates
  // to medium and the reply says honestly that we are not sure.
  {
    id: "ambiguous_chest",
    level: "medium",
    reason: "Described an unclear chest sensation. Too ambiguous to reassure.",
    pattern: /\bchest\s+(feels|feeling|felt)\b/,
  },
  {
    id: "ambiguous_neuro",
    level: "medium",
    reason: "Reported dizziness, fainting or numbness, which have serious possible causes.",
    pattern:
      /\b(dizzy|dizziness|light\s*headed|lightheadedness|faint(ed|ing)?|passed\s+out|black(ed)?\s+out|numb(ness)?|tingling)\b/,
  },
  {
    id: "ambiguous_cardiac",
    level: "medium",
    reason: "Reported palpitations or a racing heart.",
    pattern: /\b(heart\s+(is\s+)?(racing|pounding)|palpitations|racing\s+heart(beat)?)\b/,
  },
];

/**
 * Returns the HIGHEST-severity rule that matches, or null.
 *
 * Highest-severity-wins rather than first-match-wins: a message can easily say
 * "I feel dizzy and I can't breathe", and the dizziness must not be allowed to
 * shadow the breathing. The table is ordered for readability, not for meaning.
 */
export function keywordRisk(raw: string): KeywordHit | null {
  const text = normalise(raw);
  let best: Rule | null = null;

  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    if (!best || RANK[rule.level] > RANK[best.level]) best = rule;
  }

  if (!best) return null;
  return { level: best.level, matched: best.id, reason: best.reason };
}

export type LlmRisk = {
  level: RiskLevel;
  reason: string;
  /** 0-1. Recorded, never obeyed — see decideRisk(). */
  confidence: number;
} | null;

export type RiskProvenance = {
  /** Which layer's level became the final answer. */
  source: "keyword" | "llm" | "default";
  keyword_level: RiskLevel | null;
  keyword_matched: string | null;
  llm_level: RiskLevel | null;
  llm_confidence: number | null;
  /**
   * TRUE when the model proposed something LOWER than the keyword layer and
   * was overruled. This is the audit trail for invariant #2: it records the
   * guarantee actually firing, not merely that it exists.
   */
  deescalation_blocked: boolean;
  at: string;
};

export type RiskDecision = {
  level: RiskLevel;
  reason: string;
  confidence: number;
  provenance: RiskProvenance;
};

/**
 * Combine the two layers. `llm` is null when the model was not consulted or
 * its call failed — in which case the keyword layer stands alone, which is
 * exactly the situation it exists for.
 */
export function decideRisk(raw: string, llm: LlmRisk, now: Date = new Date()): RiskDecision {
  const keyword = keywordRisk(raw);
  const keywordLevel: RiskLevel = keyword?.level ?? "low";
  const llmLevel: RiskLevel = llm?.level ?? "low";

  // The whole invariant, in one line: take the max, never the model's word.
  const level: RiskLevel = RANK[llmLevel] > RANK[keywordLevel] ? llmLevel : keywordLevel;

  // Ties go to the keyword layer, because it is the deterministic one and the
  // one we can defend in a review a year from now.
  const source: RiskProvenance["source"] =
    keyword && RANK[keywordLevel] >= RANK[llmLevel]
      ? "keyword"
      : llm && RANK[llmLevel] > 0
        ? "llm"
        : "default";

  const deescalation_blocked = llm !== null && RANK[llmLevel] < RANK[keywordLevel];

  const reason =
    source === "keyword"
      ? (keyword?.reason ?? "Keyword safety net matched.")
      : source === "llm"
        ? (llm?.reason ?? "Assessed by the model.")
        : "Nothing in this message indicated a clinical risk.";

  return {
    level,
    reason,
    // A keyword hit is deterministic — it is not 90% sure, it is a rule that
    // fired. Reporting model confidence for it would be borrowed uncertainty.
    confidence: source === "keyword" ? 1 : source === "llm" ? (llm?.confidence ?? 0.5) : 1,
    provenance: {
      source,
      keyword_level: keyword?.level ?? null,
      keyword_matched: keyword?.matched ?? null,
      llm_level: llm?.level ?? null,
      llm_confidence: llm?.confidence ?? null,
      deescalation_blocked,
      at: now.toISOString(),
    },
  };
}

/** Medium and High are the levels a real clinician should be offered. */
export function needsClinician(level: RiskLevel): boolean {
  return level === "medium" || level === "high";
}
