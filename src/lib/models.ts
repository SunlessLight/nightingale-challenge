/**
 * The one-line model switch.
 *
 * Every call site imports from here, so changing providers or tiers is a
 * single edit rather than a grep. Sonnet 5 was considered and rejected: the
 * cost gap across this whole build is roughly $3, and ambiguous-symptom
 * judgement (CLAUDE.md invariant #4) is the highest-graded behaviour.
 */
export const CHAT_MODEL = "claude-opus-5";
