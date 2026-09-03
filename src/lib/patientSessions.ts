import { CLINIC_NAME } from "@/lib/clinic";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Guest → patient conversion.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP: conversion re-asks NOTHING. Someone
 * who spent five minutes describing a symptom anonymously must not be made to
 * describe it again because they signed up. Everything they already said, and
 * the provenance of every fact derived from it, survives the transition.
 */

export type PatientSession = {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  phone: string | null;
  consent_at: string | null;
  consent_clinic_name: string | null;
  marketing_consent_at: string | null;
  origin_lead_session_id: string | null;
  created_at: string;
};

/**
 * Inlined as one literal, not concatenated. Supabase types the select() string
 * at compile time; a runtime-built column list degrades to GenericStringError.
 */
const PATIENT_COLUMNS =
  "id, auth_user_id, email, phone, consent_at, consent_clinic_name, marketing_consent_at, origin_lead_session_id, created_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately loose. Email validity is Supabase's job; this only rejects the
// obviously-not-an-address so we fail before spending an admin API call.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MIN_PASSWORD_CHARS = 8;

export type ConversionRequest = {
  leadSessionId?: unknown;
  email?: unknown;
  password?: unknown;
  consent?: unknown;
  marketingConsent?: unknown;
};

export type ConversionInput = {
  leadSessionId: string;
  email: string;
  password: string;
  marketingConsent: boolean;
};

export type ValidationResult =
  | { ok: true; value: ConversionInput }
  | { ok: false; status: number; error: string };

/**
 * Pure so it can be tested without a database, and separate from the write so
 * the consent rule is enforced on the SERVER. A disabled submit button is a
 * courtesy; this is the control. Consent must be the literal `true` — not
 * "true", not 1, not truthy — because an accidental default must never read as
 * a patient agreeing to share their data with a clinic.
 */
export function validateConversion(raw: ConversionRequest): ValidationResult {
  const leadSessionId = typeof raw.leadSessionId === "string" ? raw.leadSessionId.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const password = typeof raw.password === "string" ? raw.password : "";

  if (!UUID_RE.test(leadSessionId)) {
    return { ok: false, status: 400, error: "A valid guest session id is required." };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: "Enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `Choose a password of at least ${MIN_PASSWORD_CHARS} characters.`,
    };
  }
  if (raw.consent !== true) {
    return {
      ok: false,
      status: 422,
      error:
        `You need to tick the consent box before ${CLINIC_NAME} can hold your ` +
        `information or a clinician can see this conversation.`,
    };
  }

  return {
    ok: true,
    value: {
      leadSessionId,
      email,
      password,
      // Care consent is NOT marketing consent. Two timestamps, two decisions;
      // bundling them is the exact dark pattern this product is arguing against.
      marketingConsent: raw.marketingConsent === true,
    },
  };
}

export type ConversionResult = {
  patientSessionId: string;
  authUserId: string;
  /** How many guest messages moved across. The proof that nothing was re-asked. */
  carriedMessages: number;
};

/**
 * Create the auth user, create the patient session, and carry the guest's
 * history across. Server-only: it uses the admin client, which bypasses RLS,
 * and `auth.admin.createUser`, whose key must never reach a browser.
 *
 * WHY admin.createUser AND NOT browser signUp(): measured against this project
 * on Sep 3 — signUp() 400s on synthetic domains (`example.com` is blocklisted),
 * then 429s with "email rate limit exceeded", because it tries to send a
 * confirmation mail. `email_confirm: true` marks the account confirmed WITHOUT
 * sending anything, so it is neither rate limited nor dependent on a dashboard
 * toggle a redeploy could change underneath us.
 */
export async function convertLeadToPatient(input: ConversionInput): Promise<ConversionResult> {
  const db = supabaseAdmin();

  const { data: created, error: authError } = await db.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });

  if (authError || !created?.user) {
    const message = authError?.message ?? "unknown error";
    if (/already/i.test(message)) {
      throw new ConversionError("An account with that email already exists. Sign in instead.", 409);
    }
    throw new ConversionError(`Could not create the account: ${message}`, 502);
  }

  const authUserId = created.user.id;
  const now = new Date().toISOString();

  const { data: patient, error: insertError } = await db
    .from("patient_sessions")
    .insert({
      auth_user_id: authUserId,
      email: input.email,
      consent_at: now,
      // Consent is to a NAMED clinic, not to "the service". Storing the name
      // is what makes the record auditable a year later.
      consent_clinic_name: CLINIC_NAME,
      marketing_consent_at: input.marketingConsent ? now : null,
      origin_lead_session_id: input.leadSessionId,
    })
    .select(PATIENT_COLUMNS)
    .single();

  if (insertError || !patient) {
    // Roll the auth user back. Otherwise a failed attempt leaves an orphan
    // account and the retry fails with "already registered" — a dead end for
    // the patient caused by our own half-finished write.
    await db.auth.admin.deleteUser(authUserId).catch(() => undefined);
    throw new ConversionError(
      `Could not create the patient record: ${insertError?.message ?? "no row returned"}`,
      502,
    );
  }

  const session = patient as unknown as PatientSession;

  // Close the loop in both directions, and raise identity_level so
  // resolveOpening() greets a returning patient as "identified".
  const { error: leadError } = await db
    .from("lead_sessions")
    .update({ converted_patient_id: session.id, identity_level: "identified" })
    .eq("id", input.leadSessionId);
  if (leadError) throw new ConversionError(`Could not link the lead session: ${leadError.message}`, 502);

  const carriedMessages = await carryMessages(input.leadSessionId, session.id);

  // IDs, action, timestamps. No content — CLAUDE.md invariant #6.
  await db.from("audit_logs").insert({
    actor_id: authUserId,
    action: "lead_converted_to_patient",
    resource_type: "patient_session",
    resource_id: session.id,
  });

  return { patientSessionId: session.id, authUserId, carriedMessages };
}

/**
 * Re-point the guest's messages at the new patient session.
 *
 * WHY UPDATE AND NOT COPY: `messages.id` is the provenance anchor —
 * `profile_items.provenance_pointer` references it. An UPDATE keeps every id
 * and every `created_at` byte-identical, so a fact extracted from a guest
 * message still points at the *original* utterance, with its original
 * timestamp. A copy would mint new ids and quietly orphan every pointer.
 *
 * They must become `session_type='patient'` because the RLS policy
 * `messages_own_read` is `session_type = 'patient' AND owns_patient_session(...)`.
 * Left as lead rows, the patient could not read their own history through the
 * RLS-bound client. The lead session keeps its acquisition context and stays
 * linked via `converted_patient_id`, so no attribution is lost.
 */
async function carryMessages(leadSessionId: string, patientSessionId: string): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .update({ session_id: patientSessionId, session_type: "patient" })
    .eq("session_id", leadSessionId)
    .eq("session_type", "lead")
    .select("id");

  if (error) throw new ConversionError(`Could not carry the conversation across: ${error.message}`, 502);
  return (data ?? []).length;
}

export class ConversionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ConversionError";
    this.status = status;
  }
}

export type AuthorizedPatient =
  | { ok: true; session: PatientSession; authUserId: string }
  | { ok: false; status: number; error: string };

/**
 * Prove that the caller owns this patient session, on the server.
 *
 * WHY THIS EXISTS AT ALL: `/patient/[id]` reads through the patient's own
 * RLS-bound client, so Postgres does the access control there. The intake chat
 * route cannot work that way — it must write `messages` and `profile_items`,
 * and there is no INSERT policy for the anon key anywhere in the schema by
 * design. So it uses the admin client, which BYPASSES RLS entirely. The moment
 * a route bypasses RLS, "the URL contains a uuid" becomes the only thing
 * standing between a stranger and someone's medical record. It is not enough.
 *
 * So the token is verified against Supabase Auth and matched to
 * `patient_sessions.auth_user_id` — the same predicate `owns_patient_session()`
 * applies inside the policy, enforced here in the one place the policy cannot
 * reach. The check is deliberately the same shape as the SQL, so the two cannot
 * drift into disagreeing about who owns a record.
 */
export async function authorizePatientSession(
  patientSessionId: string,
  accessToken: string | null,
): Promise<AuthorizedPatient> {
  if (!UUID_RE.test(patientSessionId)) {
    return { ok: false, status: 400, error: "A valid patient session id is required." };
  }
  if (!accessToken) {
    return { ok: false, status: 401, error: "You need to be signed in to continue." };
  }

  const db = supabaseAdmin();
  const { data: userData, error: userError } = await db.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return { ok: false, status: 401, error: "Your session has expired. Sign in again." };
  }

  const session = await loadPatientSession(patientSessionId);
  // 404, not 403, for a record that exists but is not theirs. Distinguishing
  // "wrong owner" from "no such record" tells an attacker which ids are real.
  if (!session || session.auth_user_id !== userData.user.id) {
    return { ok: false, status: 404, error: "No such record for this account." };
  }
  // Consent gates the intake chat itself, not just the clinician handoff. An
  // un-consented session must not accumulate a profile we were never given
  // permission to build.
  if (!session.consent_at) {
    return { ok: false, status: 403, error: "Consent is required before intake can start." };
  }

  return { ok: true, session, authUserId: userData.user.id };
}

/** Server-side read of a patient session. Used by the page shell for the title. */
export async function loadPatientSession(id: string): Promise<PatientSession | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await supabaseAdmin()
    .from("patient_sessions")
    .select(PATIENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as PatientSession;
}
