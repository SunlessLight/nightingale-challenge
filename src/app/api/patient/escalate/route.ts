import { NextResponse } from "next/server";
import { CLINIC_ID, CLINIC_NAME } from "@/lib/clinic";
import { createEscalation, RESPONSE_WINDOW } from "@/lib/escalations";
import { logFunnelEvent } from "@/lib/funnel";
import { loadLatestRiskyMessage } from "@/lib/messages";
import { authorizePatientSession } from "@/lib/patientSessions";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Send to Clinic. POST { patientSessionId } with `Authorization: Bearer <token>`.
 *
 * TWO THINGS THE CLIENT DOES NOT GET TO DECIDE, and they are the whole route:
 *
 *   1. WHO IT IS. This route holds the admin key and therefore bypasses RLS,
 *      exactly like /api/patient/chat, so it runs the same
 *      authorizePatientSession() check — the bearer token matched against
 *      patient_sessions.auth_user_id. A uuid in the body is not access control.
 *
 *   2. WHETHER THERE IS ANYTHING TO ESCALATE. The body carries no risk level
 *      and no message id. The server re-reads the verdict IT stored against
 *      the patient's own messages. If nothing on file is Medium or High, this
 *      returns 422 and writes nothing — a browser cannot manufacture a
 *      clinician's queue entry by posting {"level":"high"}.
 *
 * The escalation is deliberately NOT automatic on a high-risk message. A
 * clinical handoff is a disclosure of someone's conversation to another human,
 * and it is the patient's to make. The UI states plainly what will be sent
 * before they press it. What is NOT their choice is the emergency banner — a
 * High-risk message says "call 999" whether or not anything is ever sent here.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: { patientSessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patientSessionId = body.patientSessionId?.trim() ?? "";
  if (!UUID_RE.test(patientSessionId)) {
    return NextResponse.json({ error: "A valid patient session id is required." }, { status: 400 });
  }

  const bearer = request.headers.get("authorization");
  const token = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null;

  const auth = await authorizePatientSession(patientSessionId, token);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // The server's own verdict, re-read from the database. Not the client's.
  const message = await loadLatestRiskyMessage(auth.session.id);
  if (!message) {
    return NextResponse.json(
      {
        error:
          "There is nothing here that needs a clinician yet. If you are worried, " +
          "tell the assistant what is happening and it will reassess.",
      },
      { status: 422 },
    );
  }

  let result;
  try {
    result = await createEscalation({
      patientSessionId: auth.session.id,
      message,
      originLeadSessionId: auth.session.origin_lead_session_id,
    });
  } catch (cause) {
    console.error("escalation failed:", (cause as Error).message);
    return NextResponse.json(
      {
        error:
          `We could not reach ${CLINIC_NAME} just now. If this is urgent, ` +
          `do not wait for us — call the clinic or dial 999.`,
      },
      { status: 502 },
    );
  }

  const { escalation, alreadySent } = result;

  // Only write the audit and funnel rows on a genuinely new escalation, so a
  // double-tap does not inflate the clinic's numbers.
  if (!alreadySent) {
    // IDs, action, timestamps. No triage text — CLAUDE.md invariant #6.
    await supabaseAdmin().from("audit_logs").insert({
      actor_id: auth.authUserId,
      action: "escalation_created",
      resource_type: "escalation",
      resource_id: escalation.id,
    });

    await logFunnelEvent({
      sessionId: auth.session.id,
      sessionType: "patient",
      eventType: "escalation_created",
      metadata: {
        clinic_id: CLINIC_ID,
        risk_level: message.risk_level ?? "unknown",
        // Counts, not content.
        triage_bullets: escalation.triage_summary.length,
        profile_items: escalation.profile_snapshot.length,
        source_channel: escalation.acquisition_context.source_channel ?? "direct",
      },
    });
  }

  return NextResponse.json({
    escalationId: escalation.id,
    status: escalation.status,
    // Shown back to the patient verbatim. They are entitled to see exactly
    // what was disclosed about them — and it costs nothing, because it is
    // assembled from their own words and their own profile.
    triageSummary: escalation.triage_summary,
    respondWithin: RESPONSE_WINDOW,
    clinicName: CLINIC_NAME,
    createdAt: escalation.created_at,
    alreadySent,
  });
}
