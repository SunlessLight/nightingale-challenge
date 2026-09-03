import type { RiskDecision } from "@/lib/risk";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * The single write path for `messages`, for BOTH session types.
 *
 * WHY THIS FILE EXISTS: the guest chat and the patient intake chat both have to
 * persist the four risk columns (`risk_level`, `risk_reason`, `confidence`,
 * `risk_provenance`). Two copies of that mapping is how one of them quietly
 * stops writing a column after a refactor — the same reason channels.ts and
 * risk.ts are each ONE table rather than scattered conditionals. There is one
 * place risk reaches the database, and this is it.
 *
 * `risk` is optional because an ASSISTANT message has no risk of its own: risk
 * is an assessment of what the patient said. Storing the decision against the
 * assistant's reply too would double-count every escalation in any later query.
 */

export type StoredMessage = {
  id: string;
  role: string;
  content: string;
  redacted_content: string | null;
  created_at: string;
};

export type SessionType = "lead" | "patient";

const MESSAGE_COLUMNS = "id, role, content, redacted_content, created_at";

export type InsertMessageInput = {
  sessionId: string;
  sessionType: SessionType;
  role: "user" | "assistant";
  /** What they actually typed — the clinical record. */
  content: string;
  /** The only form permitted to leave our server. CLAUDE.md invariant #5. */
  redactedContent: string;
  /** Omit for assistant replies. See the note above. */
  risk?: RiskDecision;
};

export async function insertMessage(input: InsertMessageInput): Promise<StoredMessage> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .insert({
      session_id: input.sessionId,
      session_type: input.sessionType,
      role: input.role,
      content: input.content,
      redacted_content: input.redactedContent,
      ...riskColumns(input.risk),
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw new Error(`insertMessage failed: ${error.message}`);
  return data as StoredMessage;
}

/**
 * Overwrite the risk on an already-stored message.
 *
 * The patient intake route stores the KEYWORD-ONLY decision at insert time,
 * before the model has been called, and then upgrades it here once the model
 * has had its say. That ordering is deliberate: if the model call fails, times
 * out, or the request dies halfway, the keyword layer's verdict is already
 * durable in the database. The safety net is never contingent on the network
 * call it exists to survive.
 */
export async function updateMessageRisk(
  messageId: string,
  risk: RiskDecision,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("messages")
    .update(riskColumns(risk))
    .eq("id", messageId);

  if (error) console.error("updateMessageRisk failed:", error.message);
}

/** The one mapping from a RiskDecision to its four columns. */
function riskColumns(risk: RiskDecision | undefined) {
  if (!risk) return {};
  return {
    risk_level: risk.level,
    risk_reason: risk.reason,
    confidence: risk.confidence,
    // jsonb, not a bare level: it records WHICH LAYER decided, so invariant #2
    // is auditable after the fact rather than merely asserted in a comment.
    risk_provenance: risk.provenance,
  };
}

export async function loadMessages(
  sessionId: string,
  sessionType: SessionType,
): Promise<StoredMessage[]> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("session_type", sessionType)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`loadMessages failed: ${error.message}`);
  return (data ?? []) as StoredMessage[];
}
