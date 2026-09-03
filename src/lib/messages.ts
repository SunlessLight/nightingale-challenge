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

/**
 * A user message carrying the risk verdict that was stored against it.
 *
 * Separate from StoredMessage on purpose: the risk columns are only ever
 * populated on role='user' rows, so a type that always has them would be a lie
 * about assistant rows.
 */
export type RiskyMessage = StoredMessage & {
  risk_level: string | null;
  risk_reason: string | null;
  confidence: number | null;
  risk_provenance: Record<string, unknown> | null;
};

const RISKY_MESSAGE_COLUMNS =
  "id, role, content, redacted_content, created_at, risk_level, risk_reason, confidence, risk_provenance";

/**
 * The most recent thing the PATIENT said that the server itself judged to be
 * Medium or High risk.
 *
 * THIS IS THE ACCESS-CONTROL SHAPE OF THE "SEND TO CLINIC" BUTTON. The browser
 * does not get to say "this was high risk" — it says only which session it is
 * talking about, and the server re-reads the verdict it stored earlier. The
 * same instinct as validateConversion() refusing the string "true": a disabled
 * button is a courtesy, a server-side lookup is the control.
 *
 * `role='user'` is not incidental. Risk columns are written on user rows only
 * (see riskColumns above), so filtering here keeps that one rule visible in
 * both the write and the read.
 */
export async function loadLatestRiskyMessage(
  sessionId: string,
): Promise<RiskyMessage | null> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .select(RISKY_MESSAGE_COLUMNS)
    .eq("session_type", "patient")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .in("risk_level", ["medium", "high"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("loadLatestRiskyMessage failed:", error.message);
    return null;
  }
  return (data ?? null) as unknown as RiskyMessage | null;
}
