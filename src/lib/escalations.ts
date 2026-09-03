import { CLINIC_ID, RESPONSE_WINDOW } from "@/lib/clinic";
import type { RiskLevel } from "@/lib/risk";
import type { ProfileItem } from "@/lib/profile";
import { loadProfile } from "@/lib/profile";
import { supabaseAdmin } from "@/lib/supabase";
import type { RiskyMessage } from "@/lib/messages";

/**
 * Send to Clinic — the handoff to a real human.
 *
 * THE DESIGN DECISION THIS FILE IS BUILT AROUND: the triage summary is
 * ASSEMBLED, not generated. Every bullet below is either a verbatim quote of
 * something the patient typed or a field already stored in the database. No
 * model is called here at all.
 *
 * Three reasons, in order of weight:
 *
 *   1. This code path exists for the moment things are going wrong. If the
 *      Anthropic call is the thing that is down — the same call that would
 *      have written the summary — then a model-written handoff fails at
 *      precisely the moment it matters. The keyword layer is already designed
 *      this way (see risk.ts); the handoff must be too, or the safety net has
 *      a hole in its last metre.
 *   2. A generated summary can introduce a symptom the patient never
 *      described. A clinician triaging from a hallucinated symptom is a real
 *      harm, and it is invisible — the summary reads perfectly well. Quoting
 *      cannot do this.
 *   3. It costs nothing and takes no time. The intake turn is ~$0.0152 and
 *      ~5s; this is $0 and one database round trip.
 *
 * The cost is that the summary is blunter than a model would write. For a
 * clinician deciding who to ring first, blunt and true beats fluent.
 */

// Re-exported so the API route imports one module. Defined in clinic.ts,
// which has no server-only imports, because the browser needs it too.
export { RESPONSE_WINDOW };

export type EscalationStatus = "pending" | "acknowledged" | "responded" | "closed";

/** A frozen copy of one profile item — see `profile_snapshot` below. */
export type ProfileSnapshotItem = {
  id: string;
  category: string;
  value: string;
  status: string;
  /** The message id the fact came from, so the clinician can trace it. */
  provenance_pointer: string;
  updated_at: string;
};

export type AcquisitionContext = {
  clinic_id: string;
  source_channel: string | null;
  campaign_id: string | null;
  creative: string | null;
  staff_referral_topic: string | null;
  landing_timestamp: string | null;
  lead_session_id: string | null;
  /** True when this person talked to us anonymously before signing up. */
  started_anonymous: boolean;
};

export type Escalation = {
  id: string;
  triggering_message_id: string;
  patient_session_id: string | null;
  triage_summary: string[];
  profile_snapshot: ProfileSnapshotItem[];
  acquisition_context: AcquisitionContext;
  status: EscalationStatus;
  clinician_response: string | null;
  created_at: string;
};

const ESCALATION_COLUMNS =
  "id, triggering_message_id, patient_session_id, triage_summary, profile_snapshot, " +
  "acquisition_context, status, clinician_response, created_at";

/** A clinician reads this on a phone. Long enough to be useful, short enough to scan. */
const MAX_BULLETS = 5;
const MAX_QUOTE_CHARS = 240;

export type TriageInput = {
  risk: { level: RiskLevel; reason: string; source: string; matched: string | null };
  /** RAW text — see the note in buildTriageSummary(). */
  triggeringMessage: string;
  profile: Pick<ProfileItem, "category" | "value" | "status">[];
  acquisition: AcquisitionContext;
};

/**
 * Build the 1-5 bullet handoff. PURE — no database, no network — so the shape
 * of what a clinician receives is testable without either.
 *
 * WHY THE QUOTE IS THE RAW TEXT, NOT THE REDACTED TEXT: redaction (invariant
 * #5) exists to stop identifying details reaching a third party — the model.
 * The clinician is not a third party; they are the person this record is FOR,
 * they are inside the clinic's consent, and `messages.content` already holds
 * exactly this text. Redacting here would hand a clinician a sentence with
 * holes in it and no way to fill them.
 *
 * The bullets are ordered by what a triaging clinician needs first: how urgent,
 * in whose words, what they came in about, what they are taking, what they
 * react to.
 */
export function buildTriageSummary(input: TriageInput): string[] {
  const bullets: string[] = [];

  // 1. Urgency, and WHICH LAYER decided it. A clinician being handed an
  //    escalation deserves to know whether a deterministic rule fired or a
  //    model made a judgement call — those warrant different amounts of trust.
  const decidedBy =
    input.risk.source === "keyword"
      ? `emergency-phrase rule \`${input.risk.matched ?? "unknown"}\``
      : input.risk.source === "llm"
        ? "AI assessment of the conversation"
        : "default assessment";
  bullets.push(
    `${input.risk.level.toUpperCase()} RISK — ${input.risk.reason} (flagged by: ${decidedBy})`,
  );

  // 2. Their own words. The single most useful line, and the only one that
  //    cannot be paraphrased without losing information.
  bullets.push(`Patient's words: "${truncate(input.triggeringMessage, MAX_QUOTE_CHARS)}"`);

  // 3-5. The profile, grouped. Concerns and symptoms first because that is
  //      what the appointment will be about.
  const complaints = pick(input.profile, ["chief_complaint", "symptom"]);
  if (complaints.length > 0) {
    bullets.push(`Reported: ${complaints.join("; ")}`);
  }

  const medications = pick(input.profile, ["medication"]);
  if (medications.length > 0) {
    bullets.push(`Medications on file: ${medications.join("; ")}`);
  }

  const allergies = pick(input.profile, ["allergy"]);
  if (allergies.length > 0) {
    bullets.push(`Allergies: ${allergies.join("; ")}`);
  }

  // If there is room left, say where this person came from. Last, because it
  // is context for the clinic rather than clinical information — but it is the
  // reason the patient never has to explain themselves twice.
  if (bullets.length < MAX_BULLETS && input.acquisition.source_channel) {
    const origin = input.acquisition.started_anonymous
      ? `talked to us anonymously via ${input.acquisition.source_channel} first, then signed up`
      : `arrived via ${input.acquisition.source_channel}`;
    bullets.push(`Context: ${origin}.`);
  }

  return bullets.slice(0, MAX_BULLETS);
}

/**
 * Status is carried into the text, never filtered out. A stopped medication is
 * part of the history a clinician needs — the same rule as profile.ts.
 */
function pick(
  items: Pick<ProfileItem, "category" | "value" | "status">[],
  categories: string[],
): string[] {
  return items
    .filter((item) => categories.includes(item.category))
    .map((item) => (item.status === "active" ? item.value : `${item.value} (${item.status})`));
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export type CreateEscalationResult = {
  escalation: Escalation;
  /** True when this exact message had already been sent — see the note below. */
  alreadySent: boolean;
};

/**
 * Persist the handoff.
 *
 * IDEMPOTENT ON `triggering_message_id`. A worried person double-taps the
 * button; that must not put two identical rows in a clinician's queue, because
 * a duplicated escalation costs someone else their place in it. But a LATER
 * high-risk message is a genuinely new event and gets its own row, which falls
 * out of keying on the message rather than on the session.
 *
 * The profile is stored as a SNAPSHOT rather than joined at read time (see the
 * column comment in 0001_init.sql): the clinician must see what was true when
 * the patient hit send, even if the patient corrects something afterwards.
 * A live join would silently rewrite the reason the escalation was raised.
 */
export async function createEscalation(input: {
  patientSessionId: string;
  message: RiskyMessage;
  originLeadSessionId: string | null;
}): Promise<CreateEscalationResult> {
  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("escalations")
    .select(ESCALATION_COLUMNS)
    .eq("triggering_message_id", input.message.id)
    .maybeSingle();

  if (existing) {
    return { escalation: existing as unknown as Escalation, alreadySent: true };
  }

  const [profile, acquisition] = await Promise.all([
    loadProfile(input.patientSessionId),
    loadAcquisitionContext(input.originLeadSessionId),
  ]);

  const provenance = (input.message.risk_provenance ?? {}) as {
    source?: string;
    keyword_matched?: string | null;
  };

  const triage = buildTriageSummary({
    risk: {
      level: (input.message.risk_level ?? "medium") as RiskLevel,
      reason: input.message.risk_reason ?? "Flagged for clinician review.",
      source: provenance.source ?? "default",
      matched: provenance.keyword_matched ?? null,
    },
    triggeringMessage: input.message.content,
    profile,
    acquisition,
  });

  const snapshot: ProfileSnapshotItem[] = profile.map((item) => ({
    id: item.id,
    category: item.category,
    value: item.value,
    status: item.status,
    provenance_pointer: item.provenance_pointer,
    updated_at: item.updated_at,
  }));

  const { data, error } = await db
    .from("escalations")
    .insert({
      triggering_message_id: input.message.id,
      patient_session_id: input.patientSessionId,
      triage_summary: triage,
      profile_snapshot: snapshot,
      acquisition_context: acquisition,
      status: "pending",
    })
    .select(ESCALATION_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`createEscalation failed: ${error?.message ?? "no row returned"}`);
  }

  return { escalation: data as unknown as Escalation, alreadySent: false };
}

/**
 * Where this person came from, carried into the handoff so the clinic knows
 * which campaign is producing urgent cases — and so the patient never has to
 * explain how they found us. Null-safe: a direct signup has no lead session.
 */
export async function loadAcquisitionContext(
  leadSessionId: string | null,
): Promise<AcquisitionContext> {
  const empty: AcquisitionContext = {
    clinic_id: CLINIC_ID,
    source_channel: null,
    campaign_id: null,
    creative: null,
    staff_referral_topic: null,
    landing_timestamp: null,
    lead_session_id: null,
    started_anonymous: false,
  };

  if (!leadSessionId) return empty;

  const { data, error } = await supabaseAdmin()
    .from("lead_sessions")
    .select("id, source_channel, campaign_id, creative, staff_referral_topic, landing_timestamp")
    .eq("id", leadSessionId)
    .maybeSingle();

  if (error || !data) return empty;

  const lead = data as unknown as {
    id: string;
    source_channel: string;
    campaign_id: string | null;
    creative: string | null;
    staff_referral_topic: string | null;
    landing_timestamp: string;
  };

  return {
    clinic_id: CLINIC_ID,
    source_channel: lead.source_channel,
    campaign_id: lead.campaign_id,
    creative: lead.creative,
    staff_referral_topic: lead.staff_referral_topic,
    landing_timestamp: lead.landing_timestamp,
    lead_session_id: lead.id,
    // They had a lead session, so they were anonymous before they signed up.
    started_anonymous: true,
  };
}

