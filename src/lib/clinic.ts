/**
 * The single demo clinic.
 *
 * `CLINIC_ID` is written onto every lead session and every funnel event, so
 * the value_event counter can say "this clinic" honestly rather than counting
 * the whole database. Multi-tenancy is out of scope for a 48-hour build, but
 * the column exists so nothing has to be renamed to add it.
 */
export const CLINIC_ID = "sunway-family-demo";
export const CLINIC_NAME = "Sunway Family Clinic";
export const CLINIC_OPENS = "8:00am";

/**
 * What the clinic promises after a "send to clinician" handoff.
 *
 * It lives HERE, with the other plain constants, and not in escalations.ts,
 * because both the API route and the patient's browser need it — and
 * escalations.ts imports the ADMIN Supabase client. Importing it from a client
 * component would pull server-only code into the browser bundle. Constants a
 * browser needs belong in a module with no server imports.
 */
export const RESPONSE_WINDOW = "12-18 hours";
