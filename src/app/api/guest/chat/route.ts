import { NextResponse } from "next/server";
import { askClaude } from "@/lib/anthropic";
import { CLINIC_ID } from "@/lib/clinic";
import { logFunnelEvent } from "@/lib/funnel";
import {
  insertLeadMessage,
  loadLeadMessages,
  loadLeadSession,
} from "@/lib/leadSessions";
import { GUEST_SYSTEM_PROMPT } from "@/lib/prompts";
import { redact, toRedactedTurns } from "@/lib/redaction";
import { decideRisk } from "@/lib/risk";

/**
 * Guest chat. POST { leadSessionId, message }.
 *
 * ORDER OF OPERATIONS IS THE SAFETY PROPERTY (CLAUDE.md invariant #5):
 *   1. load + validate the session
 *   2. redact the raw message
 *   3. store BOTH forms
 *   4. build the model payload from redacted history ONLY
 *   5. call the model
 *   6. store the reply
 *   7. log the value_event
 *
 * Steps 2 and 3 happen before step 5 has any chance to run. The compiler
 * enforces it too: askClaude() accepts only branded `Redacted` turns.
 */

// Opus 5 thinks adaptively before answering, so a reply can exceed Vercel's
// short default. 60s is the Hobby-plan ceiling and is far more headroom than
// a guest question needs.
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 2000;

export async function POST(request: Request) {
  let body: { leadSessionId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const leadSessionId = body.leadSessionId?.trim();
  const rawMessage = body.message?.trim();

  if (!leadSessionId || !rawMessage) {
    return NextResponse.json(
      { error: "leadSessionId and message are both required." },
      { status: 400 },
    );
  }
  if (rawMessage.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` },
      { status: 413 },
    );
  }

  // 1. Session must exist and not be expired.
  const lead = await loadLeadSession(leadSessionId);
  if (!lead) {
    return NextResponse.json(
      { error: "This conversation has expired. Start a new one." },
      { status: 404 },
    );
  }

  // 2 + 3. Redact, then store both forms. `content` is the clinical record of
  // what they actually typed; `redacted_content` is the only form allowed out.
  //
  // RISK IS ASSESSED ON THE RAW TEXT, NOT THE REDACTED TEXT. Redaction can
  // rewrite a sentence ("I'm Evan and I can't breathe" loses a token), and the
  // keyword layer must see exactly what the person typed.
  //
  // `null` for the LLM layer is not a shortcut: the guest chat runs the plain
  // askClaude(), which returns prose and no risk opinion. decideRisk(raw, null)
  // is therefore the keyword layer standing alone — the case it exists for —
  // and the row carries a real, auditable verdict either way.
  const { redacted, found } = redact(rawMessage);
  const risk = decideRisk(rawMessage, null);
  await insertLeadMessage({
    leadSessionId: lead.id,
    role: "user",
    content: rawMessage,
    redactedContent: redacted,
    risk,
  });

  // 4. Payload built from redacted_content only — see toRedactedTurns().
  const history = await loadLeadMessages(lead.id);
  const turns = toRedactedTurns(history);

  // 5. The only outbound call.
  let reply: string;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const result = await askClaude({ system: GUEST_SYSTEM_PROMPT, turns });
    reply = result.text;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
  } catch (cause) {
    console.error("guest chat LLM call failed:", (cause as Error).message);
    // The model is down, but the keyword layer already ran and its verdict is
    // already stored. Ship it to the UI anyway: someone who typed "crushing
    // chest pain" must still be told to dial 999 when Anthropic is unreachable.
    // This is the whole argument for a layer that makes no network call.
    return NextResponse.json(
      {
        error:
          "I could not get a reply just now. Please try again — and if this is " +
          "urgent, call the clinic or dial 999.",
        risk: { level: risk.level, reason: risk.reason },
      },
      { status: 502 },
    );
  }

  if (!reply) {
    return NextResponse.json({ error: "Empty reply from the model." }, { status: 502 });
  }

  // 6. Store the reply. It is model output built from redacted input, so both
  // columns hold the same text.
  const stored = await insertLeadMessage({
    leadSessionId: lead.id,
    role: "assistant",
    content: reply,
    redactedContent: reply,
  });

  // 7. The guest got something useful for free. PHI-free metadata only —
  // counts and ids, never a word of what was said.
  await logFunnelEvent({
    sessionId: lead.id,
    sessionType: "lead",
    eventType: "value_event",
    metadata: {
      clinic_id: CLINIC_ID,
      source_channel: lead.source_channel,
      redaction_kinds: found.join(",") || "none",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      // A level and a rule id. Both are PHI-free by construction — the rule id
      // is one of our own constants, never a word the patient wrote.
      risk_level: risk.level,
      risk_source: risk.provenance.source,
    },
  });

  return NextResponse.json({
    id: stored.id,
    reply,
    // Surfaced so the UI can tell the guest what was removed before sending.
    // Kinds only — never the values.
    redacted: found,
    // Level and reason only. `risk_provenance` is an audit record for the
    // clinic, not something to explain to a frightened person mid-conversation.
    risk: { level: risk.level, reason: risk.reason },
  });
}
