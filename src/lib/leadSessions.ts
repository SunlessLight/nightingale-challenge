import { CLINIC_ID } from "@/lib/clinic";
import type { Channel, IdentityLevel } from "@/lib/channels";
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

export type StoredMessage = {
  id: string;
  role: string;
  content: string;
  redacted_content: string | null;
  created_at: string;
};

export async function loadLeadMessages(leadSessionId: string): Promise<StoredMessage[]> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .select("id, role, content, redacted_content, created_at")
    .eq("session_type", "lead")
    .eq("session_id", leadSessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`loadLeadMessages failed: ${error.message}`);
  return (data ?? []) as StoredMessage[];
}

/**
 * Insert one message. BOTH forms are stored: `content` is what the patient
 * actually typed (the clinical record), `redacted_content` is the only form
 * permitted to leave our server. CLAUDE.md invariant #5.
 */
export async function insertLeadMessage(input: {
  leadSessionId: string;
  role: "user" | "assistant";
  content: string;
  redactedContent: string;
}): Promise<StoredMessage> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .insert({
      session_id: input.leadSessionId,
      session_type: "lead",
      role: input.role,
      content: input.content,
      redacted_content: input.redactedContent,
    })
    .select("id, role, content, redacted_content, created_at")
    .single();

  if (error) throw new Error(`insertLeadMessage failed: ${error.message}`);
  return data as StoredMessage;
}
