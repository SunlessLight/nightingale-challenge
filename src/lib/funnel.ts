import { supabaseAdmin } from "@/lib/supabase";

/**
 * Funnel events — PHI-FREE analytics only.
 *
 * `funnel_events.metadata` carries counts, channel ids and timings. It must
 * never carry symptom text, a name, or anything a patient typed. That is the
 * same instinct as CLAUDE.md invariant #6 for audit_logs: record that
 * something happened, never what was said.
 *
 * Writes go through the admin client because there is deliberately no INSERT
 * policy for anonymous users on any table (see 0001_init.sql, WRITE POSTURE).
 * Clients read; the server writes.
 */

export const FUNNEL_EVENTS = [
  "lead_created",
  "guest_message",
  /** The brief's "give them something genuinely useful for free" moment. */
  "value_event",
] as const;
export type FunnelEventType = (typeof FUNNEL_EVENTS)[number];

export type FunnelEventInput = {
  sessionId: string;
  sessionType: "lead" | "patient";
  eventType: FunnelEventType;
  /** PHI-free. Reviewed at every call site. */
  metadata?: Record<string, string | number | boolean>;
};

export async function logFunnelEvent(input: FunnelEventInput): Promise<void> {
  const { error } = await supabaseAdmin().from("funnel_events").insert({
    session_id: input.sessionId,
    session_type: input.sessionType,
    event_type: input.eventType,
    metadata: input.metadata ?? {},
  });

  // Analytics must never take the patient's chat down with it. Log and move on.
  if (error) console.error("funnel_events insert failed:", error.message);
}

/**
 * Count DISTINCT sessions, not rows.
 *
 * The UI says "N people asked this clinic a question this week". One chatty
 * guest sending twelve messages is one person, not twelve. This whole product
 * is graded on whether it feels trustworthy, and the social-proof number is
 * the easiest place on the page to be quietly dishonest — so it is the one
 * place worth being pedantic.
 *
 * Extracted as a pure function so tests/valueEvents.test.ts can prove the
 * counting rule without a database.
 */
export function countDistinctSessions(rows: { session_id: string }[]): number {
  return new Set(rows.map((row) => row.session_id)).size;
}

export const VALUE_EVENT_WINDOW_DAYS = 7;

/**
 * A REAL database count. Never a hardcoded number, never an estimate.
 * Returns 0 when there is nothing to show; the caller renders nothing at all
 * in that case, not "0 people".
 */
export async function countValueEventPeople(
  clinicId: string,
  windowDays: number = VALUE_EVENT_WINDOW_DAYS,
): Promise<number> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin()
    .from("funnel_events")
    .select("session_id")
    .eq("event_type", "value_event")
    // jsonb containment (@>) — filters in Postgres rather than shipping every
    // clinic's rows to Node and discarding most of them.
    .contains("metadata", { clinic_id: clinicId })
    .gte("created_at", since);

  if (error) {
    console.error("value_event count failed:", error.message);
    // Fail closed: show nothing rather than a number we cannot stand behind.
    return 0;
  }

  return countDistinctSessions(data ?? []);
}

/**
 * The display rule, as a function so it is testable and so there is exactly
 * one place the zero case is decided.
 *
 * A zero count renders NOTHING — not "0 people asked", not a placeholder. An
 * empty clinic that advertises its emptiness is worse than one that says
 * nothing at all.
 */
export function valueEventCopy(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "person" : "people"} asked this clinic a question this week`;
}
