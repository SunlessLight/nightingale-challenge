# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.
**This is the only file guaranteed to load every session — safety invariants live here, not in a separate doc.**

## Collaboration Style

Evan is solo and building something this technical for the first time. After non-trivial
changes, append a short "why" note (2-4 sentences) on the *one* most interesting or
non-obvious decision in the change — not a full walkthrough. End with an invitation to go
deeper on a specific concept. Skip the note for trivial edits.

## Project Overview

**Nightingale** — a clinic loses potential patients because nobody replies fast enough when
someone engages on social, and sign-up feels invasive. This app catches that person the
instant they engage (anonymous **LeadSession**), gives them something genuinely useful for
free (a **value_event**), invites signup + consent once trust exists (**PatientSession**),
runs a safe AI intake chat (never diagnose, never miss an emergency phrase), extracts
structured facts into a live **Patient Profile** with provenance, and hands off to a real
clinician on Medium/High risk carrying full context so the patient never repeats themselves.

**Deadline:** Thurs Sep 3, 2026, 1:00 PM SGT/MYT. **Graded on** whether it feels trustworthy
and psychologically sound — not just "does the code run." Scoring weight sits in Intake +
Risk Gating, Memory & provenance, Access control, and the written brief.

Full spec: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) and the candidate brief PDF beside it.

---

## ⚠️ Safety Invariants (non-negotiable)

These are not preferences. A change that violates one of these is wrong even if it passes tests.

1. **Four phrases always flag High risk**, plus close variants:
   `crushing chest pain` · `difficulty breathing` · `heavy bleeding` · `want to hurt myself`.
2. **The keyword layer runs independently of the LLM. The LLM may escalate a risk level but
   may NEVER de-escalate a keyword hit.** Stated explicitly because this is exactly the
   invariant a well-meaning refactor silently breaks — e.g. "let the model decide, it's
   smarter." It is not a fallback for the model; it is a guarantee that outranks it.
3. **Non-diagnostic always.** No "you have X", no medication changes, no treatment plans
   beyond "consult a clinician."
4. **Ambiguous symptoms escalate or state uncertainty honestly** ("chest feels funny" →
   escalate or say we're unsure). Never false reassurance.
5. **Redaction runs before *any* text reaches the LLM** — names, IC/ID numbers, phone numbers.
   Store both `content` and `redacted_content`; only the redacted form leaves our server.
6. **Audit logs carry IDs / timestamps / event types only — never raw message content.**
   `audit_logs` has no content column, by design.
7. **Every Supabase table is created with `alter table … enable row level security;` plus
   explicit policies, at creation time** — not "later." The publishable (anon) key can read
   *any* table lacking RLS. A patient reads only their own rows; staff/clinician/nurse roles
   read consented patients.
8. **Emergency disclaimer renders under the chat box** ("If this is an emergency, exit
   Nightingale and dial 999"). **Synthetic data only** — never real patient data.

### How these are enforced in code (not by remembering)

- **Invariant #5 is enforced by the type system.** `redact()` in `src/lib/redaction.ts`
  returns a *branded* `Redacted` string, and `askClaude()` in `src/lib/anthropic.ts` accepts
  nothing else. Passing a raw `messages.content` is a compile error. The brand cannot be
  minted outside `redaction.ts`, so `toRedactedTurns()` is the only DB→model path.
  **Never add a cast to get around this** — that is the refactor this design exists to stop.
  The brand is erased at runtime, so `tests/redaction.test.ts` also asserts on the real bytes.
- **Untrusted URL params are sanitised at the boundary** (`cleanParam()` in
  `src/app/start/route.ts`). `?topic=` is spoken in the assistant's own voice and replayed to
  the model every turn, which makes it a prompt-injection vector, not just an XSS one.
- **Channel behaviour is one first-match-wins table** in `src/lib/channels.ts`, never
  scattered conditionals. The last row has no matchers, so `resolveOpening()` is total.
  Time buckets use `Intl` in **Asia/Kuala_Lumpur** — Vercel runs UTC, 8h behind the clinic.
- **Any count shown to a patient is a real DB count.** `value_event` counts **distinct
  `session_id`**, because the copy says "N *people*". Zero renders nothing, never "0".
- **Guest→patient conversion RE-POINTS messages, it never copies them.**
  `carryMessages()` in `src/lib/patientSessions.ts` UPDATEs `session_id` +
  `session_type='patient'`, so every `messages.id` and `created_at` survives and
  `profile_items.provenance_pointer` still resolves to the *original* guest utterance. The
  `session_type` flip is not cosmetic: `messages_own_read` is
  `session_type='patient' AND owns_patient_session(...)`, so lead rows are unreadable by the
  patient who wrote them. **Never "fix" this into an INSERT** — new ids orphan every pointer.
- **Consent is enforced server-side and must be the literal `true`.** `validateConversion()`
  rejects `"true"`, `1` and any other truthy value. A disabled submit button is a courtesy;
  this is the control. Care consent and marketing consent are two separate timestamps.
- **`requireEnv()` cannot be used in browser code.** It indexes `process.env` *dynamically*;
  Next.js inlines only *literal* `process.env.NEXT_PUBLIC_X` member expressions into the
  client bundle. `supabaseBrowser()`/`supabaseStranger()` read the two literals directly —
  do not tidy them back into `requireEnv()` or they throw in production only.
- **`/patient/[id]` never server-renders patient data with the admin key.** Every read goes
  through the patient's own RLS-bound client, so access control is a Postgres policy rather
  than an unguessable URL. The page runs the signed-out query live as a negative control.
- **Invariant #2 is one line in `decideRisk()`** (`src/lib/risk.ts`): it takes the **max** of
  the keyword level and the LLM level. The model is passed in as data, never consulted for
  the final answer, and `llm: null` (a failed or skipped model call) leaves the keyword layer
  standing alone — which is the situation that layer exists for. `risk_provenance` records
  `deescalation_blocked: true` whenever the model proposed something lower and was overruled,
  so the guarantee is auditable, not merely asserted.
- **Keyword rules are ONE table, highest-severity-wins** — not first-match-wins like
  `channels.ts`. "I feel dizzy and I can't breathe" must not let the dizziness rule shadow the
  breathing rule. Adding a phrase means adding a row, never editing control flow.
- **The keyword layer deliberately ignores negation and third parties.** "I don't think this
  is chest pain" and "my mother had heavy bleeding" both flag High. A false positive costs one
  unnecessary "call 999"; a false negative can cost a life. Do not add negation handling.
- **A correction changes `profile_items.status`. It cannot delete.** `planProfileMutations()`
  returns a union with `insert` / `status_change` / `unchanged` and **no delete case**, so no
  caller can express a deletion even by mistake. `provenance_pointer` is ON DELETE RESTRICT
  for the same reason: losing the message loses the fact's provenance.
- **`profile_items.patient_session_id` is a NOT NULL FK to `patient_sessions`** — a guest
  cannot have profile items. Memory extraction therefore belongs to the patient intake chat,
  not the guest chat. This is a schema constraint, not a preference.
- **`src/lib/messages.ts` is the ONE write path for `messages`**, shared by both chat routes.
  The four risk columns are mapped in a single private `riskColumns()` helper. Two copies of
  that mapping is how one route quietly stops writing a column. `insertLeadMessage()` is a
  thin wrapper — do not re-inline a direct `.from("messages").insert()` anywhere else.
- **Risk is decided on the RAW message, never the redacted one.** Redaction rewrites
  sentences, and the keyword layer must see exactly what the person typed.
- **Risk columns belong to `role='user'` rows only.** Risk is an assessment of what the
  *patient* said; storing it on the assistant's reply double-counts every escalation.
- **The patient route stores the keyword-only verdict BEFORE calling the model, then upgrades
  it with `max(keyword, llm)` afterwards.** A safety net that only exists after a successful
  network call is not a safety net. Both chat routes therefore also return the keyword verdict
  on a 502, so the emergency banner still renders when the model is unreachable. Never reorder
  this so the first write happens after the LLM call.
- **A route that uses the admin client has NO RLS, so it must authorise explicitly.**
  `/api/patient/chat` calls `authorizePatientSession()`, which verifies the bearer token
  against `patient_sessions.auth_user_id` — the same predicate `owns_patient_session()` uses,
  restated in the one place the policy cannot reach. A uuid in the request body is not access
  control. It returns 404 (not 403) for someone else's record, so the API does not confirm
  which ids exist.
- **Living-memory matching is a SOFT JOIN on model-authored text.** `matchKey()` compares the
  fact's `value`, so a value the model rewrites by one clause becomes a *new* row instead of a
  status change — measured in Phase 4, where "Advil …" came back as "Advil … — stopped last
  week" and the profile ended up asserting both `active` and `stopped` for one drug. The
  intake prompt therefore carries an explicit contract: **copy an existing fact's `value`
  character for character and change only `status`.** Do not soften or delete that paragraph;
  it is load-bearing, and it is the only thing preventing contradictory duplicates.
- **`npm test` passing does not mean the types are sound.** Vitest transpiles and strips types
  without checking them, so a function can return an object missing a required field and still
  go green. `npm run build` is the type gate — run both.
- **`zod` is present in `node_modules` but absent from `package.json`.** It is transitive, so
  the Anthropic SDK's `zodOutputFormat` helper must not be imported unless zod is added as a
  real dependency — Vercel builds with `npm ci`, which installs from the lock, and a phantom
  import is exactly how Phase 1 lost time.

---

## Definition of Done (the anti-compounding gate)

Apply per unit of work, not per phase. Building layer N+1 on unverified layer N is the one
failure mode that turns a 5-minute bug into a 5-hour bug at hour 10.

1. **It runs** — clicked through in the browser, or the test is green. "It compiles" is not evidence.
2. **`npm test` safety tests still pass.**
3. **Committed.**
4. **Any non-obvious decision or bug fix → one line** added here or to [timeline.md](timeline.md).

## Project Structure & Commands

Next.js lives at the **repo root** — one npm context, no "cd into the right subfolder" hazard.

```bash
npm run dev     # Next.js dev server
npm run build
npm test        # safety tests — must stay green
```

## Data Schema (locked — rename only with a deliberate migration)

Schema churn is the largest compounding risk here: a renamed field ripples through queries,
API routes, RLS policies, and tests.

| Table | Carries |
|---|---|
| `lead_sessions` | `clinic_id`, `source_channel`, `campaign_id`, `creative`, `identity_level`, `landing_timestamp`, `page_context`, `staff_referral_topic`, `converted_patient_id`, `expires_at` |
| `patient_sessions` | immutable internal `id`, `auth_user_id`, `email`, `phone`, `social_handles` jsonb, `consent_at`, `consent_clinic_name`, `marketing_consent_at`, `origin_lead_session_id` |
| `messages` | `session_id` + `session_type` (`lead`\|`patient`), `role`, `content`, `redacted_content`, `risk_level`, `risk_reason`, `confidence`, `risk_provenance`, `audio_transcript_id`, `created_at` |
| `profile_items` | `patient_session_id`, `category`, `value`, `status`, `provenance_pointer` → `messages.id`, `updated_at` |
| `escalations` | `triggering_message_id`, `triage_summary` jsonb, `profile_snapshot` jsonb, `acquisition_context` jsonb, `status`, `clinician_response` |
| `funnel_events` | `session_id`, `event_type`, PHI-free `metadata` jsonb |
| `audit_logs` | `actor_id`, `action`, `resource_type`, `resource_id` — **no content column, by design** |

Three design decisions worth keeping:
- **Contact points are mutable columns on an immutable internal `id`** — so `email` or `phone`
  can change without breaking history (the brief asks for this explicitly).
- **`messages.audio_transcript_id`** satisfies the brief's voice-readiness ask at zero build cost.
- **`profile_items.provenance_pointer` → `messages.id`** is what lets a guest's facts keep
  their *original* provenance across guest→patient conversion.

`profile_items.status` is how corrections work: "stopped Advil last week" marks the item
**Stopped** — it does not delete the row. Losing the fact loses the provenance.

## File Conventions

- Routes/pages: Next.js App Router under `src/app/`
- Components: `PascalCase.tsx` in `src/components/`
- Server logic / services: `camelCase.ts` in `src/lib/`
- SQL migrations: `supabase/` — every table with RLS enabled in the same file that creates it
- Tests: `tests/`

## Doc Maintenance

Two docs, two roles — don't duplicate:
- **CLAUDE.md** = current architecture + load-bearing rules
- **timeline.md** = ship log + pending TODO

When a phase completes: convert its `timeline.md` checkboxes to a `✓` section (4-6 terse
bullets, no architecture prose); update CLAUDE.md *only if* a contract, schema field, or
guardrail changed. Load-bearing whys (they constrain future code) → CLAUDE.md as a rule.
Historical whys → drop.

**Trigger phrase from the user:** "I finished [Phase X]. Update docs." → apply the above.

## Phase Status

At-a-glance only — **[timeline.md](timeline.md) owns the per-phase task list and all pending TODO detail.**

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
