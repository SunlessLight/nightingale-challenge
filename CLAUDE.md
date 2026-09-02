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
