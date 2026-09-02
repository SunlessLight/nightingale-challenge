import { describe, expect, it } from "vitest";
import { countDistinctSessions, FUNNEL_EVENTS, valueEventCopy } from "@/lib/funnel";

/**
 * Pre-pays the "value_event accuracy" test from Phase 6's required eight.
 *
 * The counting RULE is tested here without a database. That the number is a
 * real DB count rather than a constant is proved separately, by reading the
 * count, sending a message, and re-reading it — recorded in timeline.md.
 */
describe("value_event counting", () => {
  const rows = (...ids: string[]) => ids.map((session_id) => ({ session_id }));

  it("counts people, not messages", () => {
    // One chatty guest sending four messages is one person.
    expect(countDistinctSessions(rows("a", "a", "a", "a"))).toBe(1);
  });

  it("counts each distinct session once", () => {
    expect(countDistinctSessions(rows("a", "b", "a", "c", "b"))).toBe(3);
  });

  it("returns 0 for no events — the caller must then render nothing", () => {
    expect(countDistinctSessions([])).toBe(0);
  });

  it("is not order dependent", () => {
    expect(countDistinctSessions(rows("c", "a", "b"))).toBe(
      countDistinctSessions(rows("a", "b", "c")),
    );
  });

  it("declares value_event as a real funnel event type", () => {
    expect(FUNNEL_EVENTS).toContain("value_event");
  });
});

/**
 * The display rule, kept honest as its own assertion: a zero count renders
 * NOTHING. Not "0 people asked", not a placeholder. An empty clinic that
 * advertises its emptiness is worse than an empty clinic that says nothing.
 */
describe("valueEventCopy()", () => {
  it("renders nothing at all when the count is 0", () => {
    expect(valueEventCopy(0)).toBeNull();
    expect(valueEventCopy(-1)).toBeNull();
  });

  it("uses the singular for one person", () => {
    expect(valueEventCopy(1)).toBe("1 person asked this clinic a question this week");
  });

  it("uses the plural beyond one", () => {
    expect(valueEventCopy(7)).toBe("7 people asked this clinic a question this week");
  });
});
