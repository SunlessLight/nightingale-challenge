# Nightingale Timeline

> Ship log + pending TODO. Two rules:
> 1. A completed phase gets **4-6 terse bullets** — what shipped, not how it works.
>    Architecture belongs in [CLAUDE.md](CLAUDE.md).
> 2. Anything **removed or rejected keeps a one-liner**, so it isn't re-added by a later session.

**Deadline:** Thurs Sep 3, 2026, 1:00 PM SGT/MYT.
**Budget below is ~11h and has zero slack** — it replaces the BUILD_PLAN's ~24h estimate.

---

# 📍 HANDOFF — read this first (updated Sep 2, 2026, ~22:05, end of Phase 1)

## Where we are

**Phase 0: done. Phase 1: done except the Anthropic smoke call (blocked on one value from
Evan) and Vercel (Evan's to click).** Scaffold is installed, committed, building, and tested.

Accounts and keys live *outside* the repo, so a fresh session cannot see them:

| Thing | State |
|---|---|
| Supabase project + `.env` (URL, publishable key, secret key, Anthropic key) | OK — `.env` present, gitignored, verified untracked |
| `0001_init.sql` run in Supabase | OK — DONE |
| `verify_rls.sql` run | OK — both VERDICT rows PASS; 7 tables RLS-on, 13 policies, `audit_logs` 6 columns, no content column |
| Next.js scaffold installed + committed | OK — `37d2b32`, deps reconciled, `npm run build` green |
| `.env.example` committed | OK — 4 required key names + optional `ANTHROPIC_WORKSPACE_ID` |
| Vitest wired to `npm test` | OK — 6 tests green in ~250ms (`tests/env.test.ts`) |
| Supabase reachable from the app | OK — `/api/smoke` returns `reachable: true`, RLS returns no rows as expected |
| **Anthropic smoke call proven** | **BLOCKED** — 400, see below |
| Vercel environment variables added | TODO — Evan's to do |
| First Vercel deploy green | TODO — Evan's to do |

## The dirty state — RESOLVED, and the record was wrong

The previous handoff described the wrong failure. What was actually true: **`node_modules/`
did not exist at all**, and none of `@supabase/supabase-js`, `@anthropic-ai/sdk` or `vitest`
appeared in `package.json` *or* `package-lock.json`. Nothing was half-installed on disk — the
scaffold's manifest and lock had simply been copied in from the scratchpad without an install.

That is the *less* dangerous version: nothing worked locally either, so it could not have
passed locally and broken on Vercel. Fixed with `npm install`, then `npm install
@supabase/supabase-js @anthropic-ai/sdk`, then `npm install -D vitest`. All three verified
present in both the manifest and the lock — **check the lock, not just `package.json`: Vercel
runs `npm ci`, which reads only the lock.**

## The one blocker

`GET /api/smoke?run=llm` returns:

```
400 invalid_request_error — "anthropic-workspace-id is required when authenticating
with an identity-linked API key; send the id of the workspace this request acts in."
```

The `ANTHROPIC_API_KEY` in `.env` is an **identity-linked key**, which must name the workspace
each request acts in. The route already sends the header when `ANTHROPIC_WORKSPACE_ID` is set;
it is simply unset. Two fixes, either is fine:

- **Add `ANTHROPIC_WORKSPACE_ID`** to `.env` (and to Vercel) — Anthropic Console, Settings,
  Workspaces; the id looks like `wrkspc_...`. Keeps the existing key.
- **Or create a plain API key** in the Console and swap it in; plain keys need no header.

Then re-run `curl "http://localhost:3000/api/smoke?run=llm"` and Phase 1 is closed.

## Immediate next steps, in order

1. Unblock the Anthropic call (above), re-run the smoke route, confirm `ok: true`.
2. Push, then add the env vars in Vercel, Settings, Environment Variables, ticked for
   Production + Preview + Development: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, and
   `ANTHROPIC_WORKSPACE_ID` if that was the chosen fix. Local `.env` is gitignored and **never
   reaches Vercel** — by design. Env vars are read at *build* time, so **redeploy after adding**.
3. Confirm the deploy is green, then start Phase 2.
4. **Before submission: delete or auth-gate `/api/smoke`.** It is public and, with `?run=llm`,
   billable. The config-only default response is harmless; the LLM path is not.

## What the scaffold actually is

`create-next-app` was run **in a scratchpad directory, not in this repo**, and only an
explicit allowlist of files was copied across. Do it that way again if you ever re-scaffold:

- It **refuses to run in a non-empty directory**, and this repo was never empty.
- It **overwrites `.gitignore`** (the old trap).
- Files deliberately NOT copied: `.gitignore`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.git`.

Versions pinned by the scaffold: **Next 16.3.4, React 19.2.8, Tailwind v4, TypeScript 5**,
App Router + `src/` + `@/*` alias. Node 24.14.0, npm 11.9.0. Added since: Vitest 4.1.11,
`@supabase/supabase-js` ^2.114, `@anthropic-ai/sdk` ^0.123.

## Open decisions awaiting Evan

- **Supabase GitHub integration** — recommended **disconnected**; it would auto-run migrations
  on push and collide with the manual SQL-Editor path. Still unconfirmed.
- **Two additive columns** beyond the locked CLAUDE.md schema, both so RLS policies are
  expressible: `escalations.patient_session_id`, `funnel_events.session_type`. Now live in the
  database. Keep unless Evan objects.
- **`messages.risk_provenance` is `jsonb`**, not a bare timestamp — carries
  `{"source":"keyword"|"llm","matched":...,"at":...}` so the *deciding layer* is recorded. This
  is the evidence for safety invariant #2. Now live.

## Known traps

- **`next dev` appends a block to `CLAUDE.md` on every run** — not just `create-next-app`, and
  it is append-only inside `<!-- BEGIN:nextjs-agent-rules -->` markers, so the safety
  invariants are not at risk. It re-adds itself if deleted; it is **committed** so the tree
  stays clean. Kill it with `agentRules: false` in `next.config.ts` if it ever becomes a
  problem. **Do check `git diff CLAUDE.md` after the first `next dev` of a session.**
- **The Anthropic key is identity-linked** — every request needs the `anthropic-workspace-id`
  header. `src/app/api/smoke/route.ts` sends it from `ANTHROPIC_WORKSPACE_ID` when set; any
  *new* code path that constructs `new Anthropic()` must do the same, or it 400s.
- **Vitest does not read `tsconfig.json` path aliases.** The `@/*` alias is declared a second
  time in `vitest.config.mts`. Adding a new alias means editing both files.
- **`vitest.config.mts`, not `.ts`** — as `.ts` it is loaded as CommonJS and Vite warns on
  every run. The `.mts` extension makes the ESM syntax unambiguous.
- **A `language sql` function body is resolved at CREATE time.** This already bit once: the
  helpers selecting from `patient_sessions` were declared above the table and the migration
  died with `relation "public.patient_sessions" does not exist`. They now live in section 9b,
  after the tables. `language plpgsql` is only syntax-checked, which is why `set_updated_at`
  is fine up in section 1. **Do not "tidy" the helpers back to the top.**
- **The Supabase SQL Editor renders only the LAST result set** when you paste multiple
  statements. `verify_rls.sql` is now deliberately ONE `union all` query for this reason.
- **RLS failures are silent** — empty array, no error. `rls_enabled=true` with `policies=0`
  is *locked shut* and looks identical to "no data yet". When a query returns nothing, check
  policies first, not tenth.
- **Staff role lives in the JWT**, not a table (`is_staff()` reads `app_metadata.role`). After
  granting it via SQL the account **must sign out and back in** or `is_staff()` stays false.
- **`git check-ignore -v .env`** after anything touches `.gitignore`. A leaked key cannot be
  un-leaked from git history.

## Prompt to start a fresh session

```
Read timeline.md, including the HANDOFF section, and continue from where it says we are.

Before you write anything, tell me your plan and confirm you've
loaded CLAUDE.md by quoting safety invariant #2 back to me.

Stack decisions already made, don't re-ask:
Next.js App Router + TypeScript + Tailwind, npm, Vitest for `npm test`.
Everything at the repo root — no subfolder.

docs/BUILD_PLAN.md and the brief PDF in docs/ are background spec,
but timeline.md owns the phase list and its ~11h budget supersedes
BUILD_PLAN's ~24h one.
```
---

## Cut order (when time slips)

Cut in this order, and record the cut here as a one-liner:
warm-lead view → "earned email" feature → session recovery → the 4th channel.

**Never cut from Phase 4 (risk gating).** It is the highest-graded section and the one
failure mode an apology in the brief cannot recover.

## Two ordering rules (driven by the compressed budget)

- **Write the four emergency-phrase tests BEFORE the risk-gating implementation.** This is
  the one place strict test-first pays for itself here — a missed emergency phrase is
  unrecoverable, and it's graded directly.
- **Build the demo path first within each phase.** The video shows Scenario A
  (Instagram → patient) and Scenario B (risk gate → handoff). Get those two paths working
  end to end before polishing anything off-path.

---

## Phase 1 — Scaffold + schema + deploy hello-world (1.0h)

- [x] Scaffold Next.js at repo root (no subfolder) — installed, committed `37d2b32`, `npm run build` green
- [x] Supabase project + the 7 tables — run and verified Sep 2: both VERDICT rows `✓ PASS`, 7 tables RLS-on, 13 policies, `audit_logs` has no content column
- [x] `.env.example` committed; real `.env` never staged (`.env` confirmed gitignored + untracked)
- [ ] Deploy to Vercel **immediately** — something must always be live *(Evan: env vars + redeploy)*
- [~] Anthropic API key wired via `/api/smoke?run=llm` — **blocked on `ANTHROPIC_WORKSPACE_ID`**, see HANDOFF
- [x] Vitest wired so `npm test` is green (Definition of Done gate #2) — 6 tests, ~250ms
- [x] Supabase reachable from the app; RLS confirmed returning no rows to the anon key

## Phase 2 — Guest flow: 4 channels, rules config, value_event (2.0h)

- [ ] 4 entry points: `staff_referral`, `social_comment`, `instagram_ad_click`/`google_ad_click`, `website_widget`
- [ ] Ad-click channels are just query params (`?source=instagram_ad&campaign=…`) — nearly free
- [ ] Channel rules as **one config file/table** (channel × identity_level × time_of_day → opening message), not scattered if-statements
- [ ] Guest chat with redaction applied before any LLM call
- [ ] value_event counter — a **real** DB count ("N people asked this clinic a question this week"); if 0, show nothing

## Phase 3 — Auth + consent + conversion (1.5h)

- [ ] Supabase auth signup/login
- [ ] Consent checkbox → `consent_at` + `consent_clinic_name`
- [ ] LeadSession → PatientSession conversion preserving full attribution, **re-asking nothing**

## Phase 4 — Intake + risk gating + memory (3.0h) — PROTECT THIS BUDGET

- [ ] **Emergency-phrase tests written first** (4 phrases + close variants)
- [ ] Hardcoded keyword safety net — runs independently; LLM may escalate, never de-escalate
- [ ] LLM layer: `risk_level` / `risk_reason` / `confidence` / `risk_provenance`
- [ ] Non-diagnostic system prompt + emergency disclaimer under the chat box
- [ ] Living Memory: chief complaint, symptoms + timeline, medications, allergies
- [ ] Each profile item carries `value` / `status` / `provenance_pointer` / `updated_at`; corrections change **status**, never delete

## Phase 5 — Send to Clinic (1.0h)

- [ ] On Med/High risk: one clear button
- [ ] Escalation persists triggering message + 1-5 bullet triage summary + profile snapshot + provenance + acquisition context
- [ ] Confirmation + "response in 12-18 hours"; chat continues after sending
- [ ] Warm-lead view reduced to a **minimal read-only list** (first thing to cut)

## Phase 6 — The 8 required tests (1.0h)

Simplified versions are explicitly fine — they check that the cases were thought about.

- [ ] guest→patient conversion
- [ ] value_event accuracy
- [ ] escalation payload
- [ ] risk escalation (chest pain case)
- [ ] memory mutation + provenance
- [ ] redaction
- [ ] access control
- [ ] "are you a real doctor?" honesty test

## Phase 7 — README + technical brief + demo video (1.5h) — start at hour ~9, not hour ~11

- [ ] README: setup/run/test steps, **where redaction happens**, **how RBAC is enforced**
- [ ] `docs/TECHNICAL_BRIEF.md`: architecture, data schema, channel ethics green/yellow/red table, assumptions, trade-offs/cuts, voice-AI future notes
- [ ] ATTRIBUTION.txt final pass (append as each dep is added — don't reconstruct at 3am)
- [ ] 3-minute demo video: Scenario A then Scenario B
- [ ] Email to irakumar@ntngale.com, cc yunxint@sunway.edu.my, subject "Nightingale 48HR Build — Evan Yeoh"

---

## Deliberate cuts (do not re-add)

Named as deliberate cuts in the technical brief — these are bonus-only:

- Real Meta/TikTok/WhatsApp/Instagram API integration — simulated channels only
- Composite lead-scoring with decay curves — a simple transparent point sum instead
- Dormant-lead lifecycle (active → cooling → dormant → recall → suppressed)
- Conflict flagging on contradictions
- Intent-based channel rules
- `google_reviews` channel — needs a real reviews page
- Full session-recovery edge cases — a working link with intact context is enough

---

## Shipped

### ✓ Phase 0 — Foundation scaffold (Sep 2, 2026)

- `.gitignore` committed **before** any env file existed; verified `.env` is absent from `git ls-files`
- `CLAUDE.md` seeded thin (~125 lines) with the 8 safety invariants at top billing and the
  Definition of Done gate — deliberately no speculative architecture
- Data schema locked into CLAUDE.md (7 tables) so field names stop churning
- Deliverable stubs created now (`README.md`, `ATTRIBUTION.txt`, `docs/TECHNICAL_BRIEF.md`)
  so the final hour is *filling in* deliverables, not remembering they exist
- Removed: a stray copy of the **SnapIT** `CLAUDE.md`/`timeline.md` was sitting in this repo
  root and auto-loading wrong architecture into every session. Don't restore them here.
- Rejected: a separate `SAFETY.md`. Only `CLAUDE.md` is guaranteed to load each session, so
  the invariants live inside it.
