# Nightingale Timeline

> Ship log + pending TODO. Two rules:
> 1. A completed phase gets **4-6 terse bullets** — what shipped, not how it works.
>    Architecture belongs in [CLAUDE.md](CLAUDE.md).
> 2. Anything **removed or rejected keeps a one-liner**, so it isn't re-added by a later session.

**Deadline:** Thurs Sep 3, 2026, 1:00 PM SGT/MYT.
**Budget below is ~11h and has zero slack** — it replaces the BUILD_PLAN's ~24h estimate.

---

# 📍 HANDOFF — read this first (updated Sep 2, 2026, ~23:10, start of Phase 2)

## Where we are

**Phases 0 and 1 are done. The app is live on Vercel and publicly reachable.** Next up is
Phase 2 (guest flow: 4 channels, rules config, value_event).

Live: https://nightingaleai-challenge.vercel.app — landing page 200, `/api/smoke` green on
env + Supabase, verified anonymously (not just from Evan's logged-in browser).

## DO THIS FIRST — one dashboard action, not a code change

`/api/smoke?run=llm` **fails in production** with `400 anthropic-workspace-id is required`.
Vercel is still holding the **original identity-linked Anthropic key**; Evan swapped a plain
key into his local `.env`, and Vercel keeps its own separate copy that did not follow.

Fix: Vercel, Settings, Environment Variables, edit `ANTHROPIC_API_KEY` to the same plain key
that is in the local `.env`, then **Redeploy**. Confirm with:

```
curl "https://nightingaleai-challenge.vercel.app/api/smoke?run=llm"
```

Expect `"anthropic":{"called":true,"ok":true,...}`. Until that passes, no LLM feature will
work in production even though every one of them works locally.

## Then: Phase 2

Read the Phase 2 checklist below. Two standing ordering rules from the top of this file still
apply — build the demo path first, and Phase 4's emergency-phrase tests get written before
Phase 4's implementation.

## Time budget — honest state

Deadline is **Thurs Sep 3, 1:00 PM SGT**. Phases 2-7 are budgeted **10.0h** and Phase 1 ran
well over its 1.0h estimate (almost entirely on Vercel configuration, not code). There is no
slack left for another multi-hour detour. If time slips, cut in the order at the top of this
file — and **never cut from Phase 4**.

## Environment and accounts

Keys live *outside* the repo, so a fresh session cannot see them:

| Thing | State |
|---|---|
| Supabase project, 7 tables, RLS | OK — `0001_init.sql` + `verify_rls.sql` both run, both VERDICT rows PASS |
| Local `.env` | OK — 4 keys, gitignored, verified untracked |
| Vercel env vars | Partial — 4 set, but `ANTHROPIC_API_KEY` is the wrong (identity-linked) key. See above. |
| Vercel deploy | OK — Framework Preset = Next.js, Deployment Protection off, public |
| Anthropic key | Plain key locally; identity-linked key still on Vercel |

## Known traps

**Vercel**

- **Framework Preset defaulted to "Other"** and cost roughly an hour. With "Other", Vercel
  runs the build, throws away the Next.js output, and serves `public/` as a flat static site.
  Every route 404s with `X-Vercel-Error: NOT_FOUND` while `/next.svg` quietly returns 200.
  Fix is Settings, Build and Deployment, Framework Preset = **Next.js**. Note it is **not** on
  the General settings screen.
- **Diagnostic worth reusing:** when everything 404s, stop asking why it is broken and find
  what *does* return 200. Three files matching the local `public/` folder byte-for-byte
  identified the cause in seconds.
- **Vercel and the laptop hold independent copies of every secret.** Editing local `.env`
  changes nothing on Vercel, and vice versa. This is what broke the production Anthropic call.
- **Env vars bind at build time.** Editing a value in the dashboard does nothing until a
  **redeploy**. `NEXT_PUBLIC_*` values are additionally inlined into the browser bundle — which
  is why a secret must never be given a `NEXT_PUBLIC_` name.
- **Deployment Protection is on by default** and returns a bare `404: NOT_FOUND` to anyone not
  signed into the team — not a login page. It must stay **off** or the submission link is dead
  for the grader. Always test the deployed URL from an incognito window or `curl`, never from
  the logged-in browser that built it.

**Code and tooling**

- **`next dev` appends to `CLAUDE.md` on every run** — append-only, inside
  `<!-- BEGIN:nextjs-agent-rules -->` markers, so the safety invariants are not at risk. It is
  committed so the tree stays clean. `agentRules: false` in `next.config.ts` disables it.
- **Anthropic keys come in two kinds.** An *identity-linked* key 400s unless every request
  carries an `anthropic-workspace-id` header; a *plain* key does not. `/api/smoke` sends the
  header from `ANTHROPIC_WORKSPACE_ID` when set, so either kind works — any *new* call site
  must do the same or it will 400.
- **Vitest does not read `tsconfig.json` path aliases.** `@/*` is declared a second time in
  `vitest.config.mts`. A new alias means editing both files.
- **`vitest.config.mts`, not `.ts`** — as `.ts` it loads as CommonJS and Vite warns every run.

**Supabase**

- **A `language sql` function body is resolved at CREATE time.** The helpers selecting from
  `patient_sessions` were declared above the table and the migration died with
  `relation "public.patient_sessions" does not exist`. They live in section 9b, after the
  tables. `language plpgsql` is only syntax-checked, which is why `set_updated_at` is fine in
  section 1. **Do not "tidy" the helpers back to the top.**
- **The SQL Editor renders only the LAST result set** when several statements are pasted.
  `verify_rls.sql` is deliberately ONE `union all` query for this reason.
- **RLS failures are silent** — empty array, no error. `rls_enabled=true` with `policies=0` is
  *locked shut* and looks identical to "no data yet". When a query returns nothing, check
  policies first, not tenth.
- **Staff role lives in the JWT**, not a table (`is_staff()` reads `app_metadata.role`). After
  granting it via SQL the account **must sign out and back in** or `is_staff()` stays false.
- **`git check-ignore -v .env`** after anything touches `.gitignore`. A leaked key cannot be
  un-leaked from git history.

## Open decisions awaiting Evan

- **Supabase GitHub integration** — recommended **disconnected**; it would auto-run migrations
  on push and collide with the manual SQL-Editor path. Still unconfirmed.
- **Two additive columns** beyond the locked CLAUDE.md schema, both so RLS policies are
  expressible: `escalations.patient_session_id`, `funnel_events.session_type`. Live in the
  database. Keep unless Evan objects.
- **`messages.risk_provenance` is `jsonb`**, not a bare timestamp — carries
  `{"source":"keyword"|"llm","matched":...,"at":...}` so the *deciding layer* is recorded. This
  is the evidence for safety invariant #2. Live.
- **Model: `claude-opus-5`.** Considered Sonnet 5 and rejected for now — the cost gap across
  the whole build is roughly $3, and ambiguous-symptom judgement (invariant #4) is the
  highest-graded behaviour. When Phase 2 adds the first real call site, put the model id in
  `src/lib/models.ts` so switching is one line. Revisit only if demo latency is measurably bad.

## Before submission

- **Delete or auth-gate `/api/smoke`.** It is public and, with `?run=llm`, billable.
- Set a monthly spend cap in the Anthropic Console — the backstop that survives a code bug.

## Prompt to start a fresh session

```
Read timeline.md, including the HANDOFF section, and continue from where it says we are.

Before you write anything, tell me your plan and confirm you've
loaded CLAUDE.md by quoting safety invariant #2 back to me.

Stack decisions already made, don't re-ask:
Next.js App Router + TypeScript + Tailwind, npm, Vitest for `npm test`.
Everything at the repo root — no subfolder. Model is claude-opus-5.

I'm a beginner — explain mechanisms as they come up rather than just
reporting status, and show the arithmetic when money or latency is involved.

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

### ✓ Phase 1 — Scaffold + schema + deploy (Sep 2, 2026)

- Next.js 16.3.4 at the repo root; an interrupted install left `node_modules` absent and
  three packages undeclared — all now in `package.json` **and** `package-lock.json`, because
  Vercel runs `npm ci`, which reads only the lock
- `src/lib/env.ts` + 6 Vitest tests: names missing env vars, and catches a server secret
  pasted into a `NEXT_PUBLIC_` var by comparing *values*, since that mistake is inlined into
  the browser bundle at build time and cannot be undone afterwards
- `src/lib/supabase.ts` keeps the RLS-bound public client and the RLS-bypassing admin client
  separate; the admin client throws if ever constructed in a browser
- `/api/smoke` proves env + Supabase + Anthropic in one request; the billable LLM call sits
  behind `?run=llm` so a public URL cannot be made to spend money by a crawler
- Deployed to Vercel and verified **anonymously**, not from the logged-in browser that built it
- Rejected: switching to Sonnet 5 to save cost — see Open decisions above for the arithmetic

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
