import { NextResponse } from "next/server";
import { askClaudeIntake } from "@/lib/anthropic";
import { CLINIC_ID } from "@/lib/clinic";
import { logFunnelEvent } from "@/lib/funnel";
import { insertMessage, loadMessages, updateMessageRisk } from "@/lib/messages";
import { authorizePatientSession } from "@/lib/patientSessions";
import { applyProfileMutations, loadProfile, profileAsContext } from "@/lib/profile";
import { intakeSystemPrompt } from "@/lib/prompts";
import { redact, toRedactedTurns } from "@/lib/redaction";
import { decideRisk } from "@/lib/risk";

/**
 * Patient intake chat. POST { patientSessionId, message }
 * with `Authorization: Bearer <supabase access token>`.
 *
 * THE ORDER OF OPERATIONS IS THE SAFETY DESIGN, and it differs from the guest
 * route in one important way:
 *
 *   1. authorise the caller against auth_user_id (this route bypasses RLS)
 *   2. redact the raw message
 *   3. decide risk with the KEYWORD LAYER ALONE and STORE IT NOW
 *   4. build the model payload from redacted history only
 *   5. call the model — reply + risk opinion + facts, one round trip
 *   6. re-decide with max(keyword, llm) and update the stored risk
 *   7. write the profile mutations, provenance-pointed at the user's message
 *   8. store the reply
 *
 * Step 3 happens BEFORE step 5 on purpose. If the model call fails, times out,
 * or the process dies, the keyword layer's verdict is already durable. A safety
 * net that only exists after a successful network call is not a safety net.
 *
 * Step 6 is CLAUDE.md invariant #2. decideRisk() takes the max, so the model
 * can raise the level and can never lower it — see src/lib/risk.ts.
 */

// Intake is the heavier call: a forced tool at effort "medium". Measured on
// Sep 3 at 4.6-5.3s against the real API, so 60s is generous headroom, and 60s
// is also the Vercel Hobby ceiling.
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 2000;

export async function POST(request: Request) {
  let body: { patientSessionId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patientSessionId = body.patientSessionId?.trim() ?? "";
  const rawMessage = body.message?.trim();

  if (!rawMessage) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }
  if (rawMessage.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` },
      { status: 413 },
    );
  }

  // 1. Authorisation. This route holds the admin key, so this check is the
  //    access control — not the unguessability of the id in the body.
  const bearer = request.headers.get("authorization");
  const token = bearer?.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : null;

  const auth = await authorizePatientSession(patientSessionId, token);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 2 + 3. Redact, assess with the keyword layer, and store both forms plus a
  //        real verdict — all before anything leaves this server.
  //        Risk is assessed on the RAW text: redaction rewrites sentences, and
  //        the keyword layer must see exactly what the person typed.
  const { redacted, found } = redact(rawMessage);
  const keywordOnly = decideRisk(rawMessage, null);

  const userMessage = await insertMessage({
    sessionId: auth.session.id,
    sessionType: "patient",
    role: "user",
    content: rawMessage,
    redactedContent: redacted,
    risk: keywordOnly,
  });

  // 4. Payload built from redacted_content only — see toRedactedTurns(), the
  //    only function that can mint the branded Redacted type from a DB string.
  const [history, profileBefore] = await Promise.all([
    loadMessages(auth.session.id, "patient"),
    loadProfile(auth.session.id),
  ]);
  const turns = toRedactedTurns(history);

  // 5. The only outbound call: reply + risk opinion + facts in one round trip.
  let intake;
  try {
    intake = await askClaudeIntake({
      system: intakeSystemPrompt(profileAsContext(profileBefore)),
      turns,
    });
  } catch (cause) {
    console.error("patient intake LLM call failed:", (cause as Error).message);
    // The keyword verdict is already in the database and is already correct.
    // Return it so a High-risk message still raises the emergency banner while
    // the model is unreachable. This is the layer earning its existence.
    return NextResponse.json(
      {
        error:
          "I could not get a reply just now. Please try again — and if this is " +
          "urgent, call the clinic or dial 999.",
        risk: { level: keywordOnly.level, reason: keywordOnly.reason },
      },
      { status: 502 },
    );
  }

  // 6. INVARIANT #2. The model is passed in as data. decideRisk takes the max
  //    of the two layers, so `intake.risk` can only ever raise the level.
  //    `risk_provenance.deescalation_blocked` records the moment it tried to
  //    lower one and was overruled.
  const finalRisk = decideRisk(rawMessage, intake.risk);
  await updateMessageRisk(userMessage.id, finalRisk);

  // 7. Living memory. The provenance pointer is the id of the message the
  //    facts came from — the patient's own words, which is what makes each
  //    profile item traceable. A correction changes status; nothing deletes.
  const mutations = await applyProfileMutations({
    patientSessionId: auth.session.id,
    facts: intake.facts,
    provenancePointer: userMessage.id,
  });

  // 8. Store the reply. Model output built from redacted input, so both columns
  //    hold the same text. No risk columns — risk describes what the PATIENT
  //    said, and duplicating it here would double-count every escalation.
  const reply = intake.reply.trim();
  const stored = reply
    ? await insertMessage({
        sessionId: auth.session.id,
        sessionType: "patient",
        role: "assistant",
        content: reply,
        redactedContent: reply,
      })
    : null;

  // 9. PHI-free metadata: ids, counts, levels and our own rule ids. Never a
  //    word of what was said. CLAUDE.md invariant #6.
  await logFunnelEvent({
    sessionId: auth.session.id,
    sessionType: "patient",
    eventType: "intake_message",
    metadata: {
      clinic_id: CLINIC_ID,
      redaction_kinds: found.join(",") || "none",
      input_tokens: intake.inputTokens,
      output_tokens: intake.outputTokens,
      risk_level: finalRisk.level,
      risk_source: finalRisk.provenance.source,
      deescalation_blocked: String(finalRisk.provenance.deescalation_blocked),
      profile_inserts: mutations.filter((m) => m.action === "insert").length,
      profile_status_changes: mutations.filter((m) => m.action === "status_change").length,
    },
  });

  return NextResponse.json({
    id: stored?.id ?? userMessage.id,
    reply,
    redacted: found,
    // Level and reason only — the full provenance is an audit record for the
    // clinic, not something to explain to a worried person mid-conversation.
    risk: { level: finalRisk.level, reason: finalRisk.reason },
    // So the UI can refresh the profile panel only when it actually changed.
    profileChanged: mutations.some((m) => m.action !== "unchanged"),
  });
}
