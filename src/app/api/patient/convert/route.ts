import { NextResponse } from "next/server";
import { CLINIC_ID } from "@/lib/clinic";
import { logFunnelEvent } from "@/lib/funnel";
import { loadLeadSession } from "@/lib/leadSessions";
import {
  ConversionError,
  convertLeadToPatient,
  validateConversion,
} from "@/lib/patientSessions";

/**
 * POST /api/patient/convert
 * { leadSessionId, email, password, consent, marketingConsent }
 *
 * The signup + consent moment. It runs entirely on the server because it holds
 * the Supabase secret key: `auth.admin.createUser` is what lets us confirm the
 * account without sending an email (see patientSessions.ts for the measured
 * reason browser signUp() is unusable here).
 *
 * The browser signs itself in afterwards with the same credentials, so the
 * patient's own RLS-bound session is created in the tab that will use it.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateConversion((body ?? {}) as Record<string, unknown>);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: validated.status });
  }
  const input = validated.value;

  // The lead session must exist and not have expired. Converting a stale id
  // would create a patient with no history — the exact "you have to start
  // over" experience this phase exists to prevent.
  const lead = await loadLeadSession(input.leadSessionId);
  if (!lead) {
    return NextResponse.json(
      { error: "That guest conversation has expired. Start a new one." },
      { status: 404 },
    );
  }
  if (lead.converted_patient_id) {
    return NextResponse.json(
      { error: "This conversation has already been claimed by an account." },
      { status: 409 },
    );
  }

  let result;
  try {
    result = await convertLeadToPatient(input);
  } catch (cause) {
    if (cause instanceof ConversionError) {
      return NextResponse.json({ error: cause.message }, { status: cause.status });
    }
    console.error("conversion failed:", (cause as Error).message);
    return NextResponse.json({ error: "Sign-up failed. Please try again." }, { status: 500 });
  }

  // PHI-free: counts, ids and the channel that earned the conversion. Note it
  // is logged against the PATIENT session, so the funnel can join a signup back
  // to the ad that produced it without ever touching what was said.
  await logFunnelEvent({
    sessionId: result.patientSessionId,
    sessionType: "patient",
    eventType: "consent_granted",
    metadata: {
      clinic_id: CLINIC_ID,
      source_channel: lead.source_channel,
      origin_lead_session_id: lead.id,
      carried_messages: result.carriedMessages,
      marketing_consent: input.marketingConsent,
    },
  });

  return NextResponse.json({
    patientSessionId: result.patientSessionId,
    carriedMessages: result.carriedMessages,
  });
}
