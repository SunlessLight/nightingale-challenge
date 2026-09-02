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
