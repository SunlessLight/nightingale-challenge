import { CLINIC_ID } from "@/lib/clinic";
import type { Channel, IdentityLevel } from "@/lib/channels";
import { insertMessage, loadMessages, type StoredMessage } from "@/lib/messages";
import type { RiskDecision } from "@/lib/risk";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Lead sessions — the anonymous capture that happens BEFORE we ask for
 * anything. Everything here runs through the admin client on the server; the
 * anon key has no INSERT policy anywhere by design.
 */

export type LeadSession = {
  id: string;
  clinic_id: string;
  source_channel: Channel;
  campaign_id: string | null;
  creative: string | null;
  identity_level: IdentityLevel;
  landing_timestamp: string;
  staff_referral_topic: string | null;
  converted_patient_id: string | null;
  expires_at: string;
};

const LEAD_COLUMNS =
  "id, clinic_id, source_channel, campaign_id, creative, identity_level, " +
  "landing_timestamp, staff_referral_topic, converted_patient_id, expires_at";

export type CreateLeadInput = {
  channel: Channel;
  campaignId?: string | null;
  creative?: string | null;
  staffReferralTopic?: string | null;
  /** PHI-free arrival context: referrer, entry path. Never message content. */
  pageContext?: Record<string, string>;
};

export async function createLeadSession(input: CreateLeadInput): Promise<LeadSession> {
  const { data, error } = await supabaseAdmin()
    .from("lead_sessions")
    .insert({
      clinic_id: CLINIC_ID,
      source_channel: input.channel,
      campaign_id: input.campaignId ?? null,
      creative: input.creative ?? null,
      // Every Phase 2 arrival is anonymous by definition — we have asked for
      // nothing yet. Phase 3's conversion is what raises this.
      identity_level: "anonymous",
      staff_referral_topic: input.staffReferralTopic ?? null,
      page_context: input.pageContext ?? {},
    })
    .select(LEAD_COLUMNS)
    .single();

  if (error) throw new Error(`createLeadSession failed: ${error.message}`);
  return data as unknown as LeadSession;
}

/** Returns null for a missing OR expired session — the caller renders a 404. */
export async function loadLeadSession(id: string): Promise<LeadSession | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const { data, error } = await supabaseAdmin()
    .from("lead_sessions")
    .select(LEAD_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const session = data as unknown as LeadSession;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;
  return session;
}

/**
 * Message reads and writes live in `src/lib/messages.ts` — ONE path shared with
 * the patient intake chat, so the risk columns cannot be written by one route
 * and forgotten by the other. These two are thin lead-flavoured wrappers.
 */
export type { StoredMessage };

export async function loadLeadMessages(leadSessionId: string): Promise<StoredMessage[]> {
  return loadMessages(leadSessionId, "lead");
}

/**
 * Insert one guest message. BOTH forms are stored: `content` is what the
 * patient actually typed (the clinical record), `redacted_content` is the only
 * form permitted to leave our server. CLAUDE.md invariant #5.
 *
 * `risk` is optional so `/start`'s canned opening — an assistant message nobody
 * has assessed — does not have to invent one.
 */
export async function insertLeadMessage(input: {
  leadSessionId: string;
  role: "user" | "assistant";
  content: string;
  redactedContent: string;
  risk?: RiskDecision;
}): Promise<StoredMessage> {
  return insertMessage({
    sessionId: input.leadSessionId,
    sessionType: "lead",
    role: input.role,
    content: input.content,
    redactedContent: input.redactedContent,
    risk: input.risk,
  });
}
