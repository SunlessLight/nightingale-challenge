# Nightingale Timeline

> Ship log + pending TODO. Two rules:
> 1. A completed phase gets **4-6 terse bullets** — what shipped, not how it works.
>    Architecture belongs in [CLAUDE.md](CLAUDE.md).
> 2. Anything **removed or rejected keeps a one-liner**, so it isn't re-added by a later session.

**Deadline:** Thurs Sep 3, 2026, 1:00 PM SGT/MYT.
**Budget below is ~11h and has zero slack** — it replaces the BUILD_PLAN's ~24h estimate.

---

# 📍 HANDOFF — read this first (updated Sep 2, 2026, ~21:50, mid-Phase-1)

## Where we are

**Phase 0: done. Phase 1: database is DONE and verified. Scaffold is HALF-INSTALLED —
read "The dirty state" below before running anything.**

Accounts and keys live *outside* the repo, so a fresh session cannot see them:

| Thing | State |
|---|---|
| Supabase project + `.env` (URL, publishable key, secret key, Anthropic key) | ✅ `.env` present, gitignored, verified untracked |
| **`0001_init.sql` run in Supabase** | ✅ **DONE** — succeeded after the ordering fix below |
| **`verify_rls.sql` run** | ✅ **DONE** — both VERDICT rows `✓ PASS`; 7 tables RLS-on, 13 policies, `audit_logs` 6 columns, no content column |
| Next.js scaffold files in repo | ⚠️ Copied in, **uncommitted**, install incomplete |
| Vercel environment variables added | ❌ Not done |
| First Vercel deploy green | ❌ Not done |
| Anthropic smoke call proven | ❌ Not done |
| Vitest wired to `npm test` | ❌ Not done |

## The dirty state — fix this first

An `npm install` was interrupted mid-flight. The result is **inconsistent, and it fails in a
way that passes locally and breaks on Vercel**:

- `@supabase/supabase-js` and `@anthropic-ai/sdk` are **present in `node_modules` but NOT
  declared in `package.json`**. npm wrote the dependency tree, then was killed before saving
  the manifest. `import` works on this machine; `npm ci` on Vercel installs neither.
- `vitest` never installed at all, but `package.json` already has `"test": "vitest run"` —
  so `npm test` currently fails with "vitest: not found", not with a failing test.
- `package.json` name is already set to `nightingale` and the two test scripts are already
  added. Don't redo those.

**Recovery (both commands are idempotent — just run them):**

```bash
npm install @supabase/supabase-js @anthropic-ai/sdk   # reconciles package.json + lock
npm install -D vitest
git diff package.json                                  # confirm all three now declared
```

## Immediate next steps, in order

1. **Fix the dirty state above.** Verify with `git diff package.json` that all three packages
   are declared — not just present on disk.
2. **Commit the scaffold.** It is currently 9 untracked paths (`package.json`,
   `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`,
   `eslint.config.mjs`, `next-env.d.ts`, `src/`, `public/`).
3. **`.env.example`** — key names only, no values, committed.
4. **Vitest config + one trivial green test in `tests/`**, so Definition of Done gate #2
   ("`npm test` still passes") is real from hour one rather than aspirational.
5. **`npm run build` locally** before pushing — a red Vercel build is slower to diagnose than
   a red local one.
6. **Push, then add the 4 Vercel env vars** → Settings → Environment Variables, ticked for
   Production + Preview + Development:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `ANTHROPIC_API_KEY`. Local `.env` is gitignored and **never reaches Vercel** — by design.
   Env vars are read at *build* time, so **redeploy after adding them**.
7. **Anthropic smoke call** — one route, proven once, then Phase 1 is closed.

## What the scaffold actually is

`create-next-app` was run **in a scratchpad directory, not in this repo**, and only an
explicit allowlist of files was copied across. Do it that way again if you ever re-scaffold:

- It **refuses to run in a non-empty directory**, and this repo was never empty.
- It **overwrites `.gitignore`** (the old trap), and now also **generates its own `CLAUDE.md`
  and `AGENTS.md`** — which would have silently replaced the safety invariants.
- Files deliberately NOT copied: `.gitignore`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.git`.

Versions pinned by the scaffold: **Next 16.3.4, React 19.2.8, Tailwind v4, TypeScript 5**,
App Router + `src/` + `@/*` alias. Node 24.14.0, npm 11.9.0.

## Open decisions awaiting Evan

- **Supabase GitHub integration** — recommended **disconnected**; it would auto-run migrations
  on push and collide with the manual SQL-Editor path. Still unconfirmed.
- **Two additive columns** beyond the locked CLAUDE.md schema, both so RLS policies are
  expressible: `escalations.patient_session_id`, `funnel_events.session_type`. Now live in the
  database. Keep unless Evan objects.
- **`messages.risk_provenance` is `jsonb`**, not a bare timestamp — carries
  `{"source":"keyword"|"llm","matched":…,"at":…}` so the *deciding layer* is recorded. This is
  the evidence for safety invariant #2. Now live.

## Known traps

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
Read timeline.md, including the HANDOFF section, and continue Phase 1.

Before you write anything, tell me your plan and confirm you've
loaded CLAUDE.md by quoting safety invariant #2 back to me.

Start by fixing the half-installed npm state described under
"The dirty state" — don't build on top of it.

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

- [~] Scaffold Next.js at repo root (no subfolder) — files copied in, **npm install incomplete**, uncommitted
- [x] Supabase project + the 7 tables — run and verified Sep 2: both VERDICT rows `✓ PASS`, 7 tables RLS-on, 13 policies, `audit_logs` has no content column
- [ ] `.env.example` committed; real `.env` never staged (`.env` confirmed gitignored + untracked)
- [ ] Deploy to Vercel **immediately** — something must always be live
- [ ] Anthropic API key wired, one smoke call proven
- [ ] Vitest wired so `npm test` is green (Definition of Done gate #2)

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
