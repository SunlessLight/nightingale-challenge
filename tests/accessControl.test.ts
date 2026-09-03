import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 6's access-control test — CLAUDE.md invariant #7.
 *
 * Access control here has TWO enforcement points, and this file covers both,
 * because each one is invisible from the other:
 *
 *   A. Postgres RLS, for every path that uses the publishable (anon) key —
 *      the patient dashboard, and any stranger with the URL. A table without
 *      `enable row level security` is world-readable with a key that ships in
 *      the browser bundle, so the migration is scanned as a fixture.
 *   B. authorizePatientSession(), for the ONE route that holds the admin key
 *      and therefore has no RLS at all. `/api/patient/chat` must restate the
 *      policy in TypeScript, because the policy cannot reach it.
 *
 * The live proof (signed in: 9 messages; signed out with the same URL and the
 * same key: 0 rows) was run in production and is recorded in timeline.md. This
 * file is what stops a later edit from silently removing it.
 */

// ---------------------------------------------------------------------------
// A. The migration itself — every table, RLS on, at creation time.
// ---------------------------------------------------------------------------

const SQL = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/0001_init.sql", import.meta.url)),
  "utf8",
);

const TABLES = [...SQL.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

describe("the migration creates no table without RLS", () => {
  it("found the tables to check", () => {
    // Guards against the regex silently matching nothing and the whole
    // describe block below passing vacuously.
    expect(TABLES.length).toBeGreaterThanOrEqual(7);
    expect(TABLES).toContain("messages");
    expect(TABLES).toContain("profile_items");
  });

  it.each(TABLES)("enables row level security on %s", (table) => {
    expect(SQL).toMatch(new RegExp(`alter table public\\.${table}\\s+enable row level security;`));
  });

  it.each(TABLES)("gives %s at least one explicit policy", (table) => {
    // RLS with no policy denies everything, which is safe but useless; RLS
    // with a policy is the actual design. Both halves have to be present.
    expect(SQL).toMatch(new RegExp(`create policy \\w+ on public\\.${table}`));
  });
});

describe("audit_logs has no content column — invariant #6", () => {
  const block = SQL.slice(SQL.indexOf("create table if not exists public.audit_logs"));
  const columns = block.slice(0, block.indexOf(");"));

  it("logs ids, an action and a timestamp only", () => {
    expect(columns).toMatch(/actor_id/);
    expect(columns).toMatch(/action/);
    expect(columns).toMatch(/resource_type/);
  });

  it("has no column that could hold what someone said", () => {
    // The failure this prevents is not malice, it is convenience: someone adds
    // `details text` "just for debugging" and the audit table becomes an
    // unredacted copy of the conversation.
    expect(columns).not.toMatch(/\bcontent\b/);
    expect(columns).not.toMatch(/\bmessage\b/);
    expect(columns).not.toMatch(/\bnotes\b/);
  });
});

describe("messages stores both forms — invariant #5", () => {
  const block = SQL.slice(SQL.indexOf("create table if not exists public.messages"));
  const columns = block.slice(0, block.indexOf(");"));

  it("keeps the raw text as the clinical record and the redacted text beside it", () => {
    expect(columns).toMatch(/\bcontent\s+text not null/);
    expect(columns).toMatch(/\bredacted_content\s+text/);
  });
});

describe("a patient reads only their own rows", () => {
  it("scopes the messages read policy to the owner AND to patient rows", () => {
    // The session_type half is not cosmetic. Lead rows are re-pointed at the
    // patient session on conversion and flipped to 'patient'; without that
    // predicate the policy shape would let a patient read lead rows generally.
    const policy = SQL.slice(SQL.indexOf("create policy messages_own_read"));
    const body = policy.slice(0, policy.indexOf(";"));
    expect(body).toMatch(/session_type\s*=\s*'patient'/);
    expect(body).toMatch(/owns_patient_session/);
  });
});

// ---------------------------------------------------------------------------
// B. The admin-key route's own check. A uuid in the body is not access control.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  row: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => ({
    auth: {
      getUser: async () =>
        state.user
          ? { data: { user: state.user }, error: null }
          : { data: null, error: { message: "invalid token" } },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) }),
    }),
  }),
}));

const { authorizePatientSession } = await import("@/lib/patientSessions");

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const OWNER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SOMEONE_ELSE = "99999999-8888-7777-6666-555555555555";

const consented = {
  id: SESSION_ID,
  auth_user_id: OWNER,
  consent_at: "2026-09-03T03:08:06.000Z",
  consent_clinic_name: "Sunway Family Clinic",
};

beforeEach(() => {
  state.user = { id: OWNER };
  state.row = consented;
});

describe("authorizePatientSession — the check the admin key removes RLS from", () => {
  it("lets the owner of a consented session through", async () => {
    const result = await authorizePatientSession(SESSION_ID, "a-valid-token");
    expect(result.ok).toBe(true);
  });

  it("refuses with 401 when no bearer token is presented", async () => {
    const result = await authorizePatientSession(SESSION_ID, null);
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses with 401 when the token does not resolve to a user", async () => {
    state.user = null;
    const result = await authorizePatientSession(SESSION_ID, "expired-token");
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses with 400 when the id is not even a uuid", async () => {
    const result = await authorizePatientSession("not-a-uuid", "a-valid-token");
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses SOMEONE ELSE'S session — a real uuid is not authorisation", async () => {
    // The whole point. The browser sends `patientSessionId` in the body; if
    // possessing the id were enough, forwarding a link would forward a medical
    // record.
    state.user = { id: SOMEONE_ELSE };
    const result = await authorizePatientSession(SESSION_ID, "a-valid-token");
    expect(result).toMatchObject({ ok: false });
  });

  it("returns 404 rather than 403 for someone else's record", async () => {
    // 403 means "this exists and is not yours", which confirms to an attacker
    // that the id is real. 404 tells them nothing they did not already know.
    state.user = { id: SOMEONE_ELSE };
    const result = await authorizePatientSession(SESSION_ID, "a-valid-token");
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("returns 404 for a session that does not exist, with the same wording", async () => {
    state.row = null;
    const mismatch = await authorizePatientSession(SESSION_ID, "a-valid-token");
    expect(mismatch).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses with 403 when the session exists and is theirs but consent is missing", async () => {
    // Consent gates the intake chat itself, not just the clinician handoff:
    // an un-consented session must not accumulate a profile we were never
    // given permission to build.
    state.row = { ...consented, consent_at: null };
    const result = await authorizePatientSession(SESSION_ID, "a-valid-token");
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
