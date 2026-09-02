# Nightingale Timeline

> Ship log + pending TODO. Two rules:
> 1. A completed phase gets **4-6 terse bullets** — what shipped, not how it works.
>    Architecture belongs in [CLAUDE.md](CLAUDE.md).
> 2. Anything **removed or rejected keeps a one-liner**, so it isn't re-added by a later session.

**Deadline:** Thurs Sep 3, 2026, 1:00 PM SGT/MYT.
**Budget below is ~11h and has zero slack** — it replaces the BUILD_PLAN's ~24h estimate.

---

# 📍 HANDOFF — read this first (updated Sep 3, 2026, ~00:20, start of Phase 3)

## Where we are

**Phases 0, 1 and 2 are done.** The guest flow works end to end in production: four channels,
one rules table, redaction before the LLM, and a real value_event count. Next up is Phase 3
(auth + consent + LeadSession → PatientSession conversion).

Live: https://nightingaleai-challenge.vercel.app — verified anonymously by curl, not from
Evan's logged-in browser.

## Nothing is blocking

The Phase 1 blocker is cleared: Vercel now holds the plain Anthropic key, and
`/api/smoke?run=llm` returns `"anthropic":{"called":true,"ok":true,"model":"claude-opus-5"}`.

## What Phase 3 must not break

- **Do not re-ask a guest anything.** `lead_sessions.converted_patient_id` and
  `patient_sessions.origin_lead_session_id` already exist; conversion sets both and carries
  `messages` across by leaving `session_type='lead'` rows where they are, with
  `profile_items.provenance_pointer` still pointing at the ORIGINAL guest message.
- **Redaction stays structural.** `askClaude()` accepts only the branded `Redacted` type.
  Any new LLM call site must build turns via `toRedactedTurns()`; nothing else can mint the
  brand. Do not add a cast to get around it.
- **`resolveOpening()` already has an `identity_level: "identified"` row** for returning
  patients. Phase 3 raises `identity_level` — the greeting is already written and tested.

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
| Vercel env vars | OK — 4 set; `ANTHROPIC_API_KEY` swapped to the plain key and redeployed |
| Vercel deploy | OK — Framework Preset = Next.js, Deployment Protection off, public |
| Anthropic key | Plain key in both places; `/api/smoke?run=llm` green in production |

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
- **Model: `claude-opus-5`** — settled, id isolated in `src/lib/models.ts`. Measured in Phase 2
  at **~5.1-5.8s** and **~$0.0085 per guest message** (703 input / 199 output tokens at
  $5/$25 per 1M). Fine for a typing indicator; revisit only if Phase 4 pushes it past ~8s.

## Before submission

- **Delete or auth-gate `/api/smoke`.** It is public and, with `?run=llm`, billable.
- Set a monthly spend cap in the Anthropic Console — the backstop that survives a code bug.

## Prompt to start a fresh session

```
Read timeline.md, including the HANDOFF section, and continue from where it
says we are. We're starting Phase 3 (auth + consent + LeadSession to
PatientSession conversion).

Before you write anything: tell me your plan, and confirm you've loaded
CLAUDE.md by quoting safety invariant #2 back to me.

Already done - do not redo:
- Phase 2 shipped. Four channels, one rules table, redaction enforced by a
  branded `Redacted` type, real value_event count. 37 tests green.
- Production LLM calls work; /api/smoke?run=llm is green anonymously.

Stack decisions already made - don't re-ask:
Next.js App Router + TypeScript + Tailwind, npm, Vitest, everything at the
repo root, model claude-opus-5 with the id in src/lib/models.ts. Chat is
non-streaming with a typing indicator.

How I want you to work:
- I'm a beginner. Explain mechanisms as they come up rather than just
  reporting status, and show the arithmetic when money or latency matters.
- Don't tell me something works until you've actually run it. "It compiles"
  is not evidence - that's the Definition of Done in CLAUDE.md.
- When you diagnose something, separate what you measured from what you
  inferred, and say which is which.
- Verify anything deployed as an anonymous stranger (curl or incognito),
  never from my logged-in browser.

The Phase 3 requirement that is easy to get wrong:
- Conversion must re-ask NOTHING. The guest's messages and their provenance
  survive the guest->patient transition intact.

Time: deadline Thurs Sep 3, 1:00 PM SGT. Phases 3-7 are budgeted ~8h with no
slack. If we slip, cut in the order at the top of timeline.md - and never cut
from Phase 4.
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

### ✓ Phase 2 — Guest flow: 4 channels, rules config, value_event (Sep 3, 2026)

- `/start?source=…` is the single entry route for all four channels; it inserts the
  `lead_session`, stores the channel-appropriate opening as a real assistant message, logs
  `lead_created`, and 302s to `/guest/<uuid>` — id in the path, not a cookie, which also
  gives session recovery for free
- Redaction is enforced by the **type system**: `redact()` returns a branded `Redacted`
  string and `askClaude()` accepts nothing else, so passing raw `content` is a compile error.
  Proved at runtime by reading a row back out of Supabase — `content` holds the name/NRIC/
  phone, `redacted_content` holds `[REDACTED_NAME]`/`[REDACTED_ID]`/`[REDACTED_PHONE]`
- Channel rules are one first-match-wins table in `src/lib/channels.ts`. Time buckets use
  `Intl` in **Asia/Kuala_Lumpur**, not server time — Vercel runs UTC, 8h behind, so a naive
  `getHours()` greets a 9am patient with the after-hours message. The after-hours row is
  deliberately **first** so it outranks channel flavour: claiming a human is standing by at
  2am is a small lie, and this build is graded on trust
- value_event counter is a real DB count of **distinct `session_id`** over 7 days, filtered
  in-Postgres with the jsonb `@>` operator. Verified live: rows 1→2→3 while distinct people
  went 1→1→2, so a chatty guest counts once. `count === 0` renders nothing, not "0 people"
- Untrusted `?topic=`/`?campaign=` params are sanitised at the boundary because the topic is
  spoken in the assistant's voice and replayed to the model — a **prompt-injection** vector,
  not just an XSS one
- 37 tests green (was 6); `npm run build` green; all four channels clicked through; guest
  chat measured at **~5.1–5.8s** and **~$0.0085/message** (703 in / 199 out at Opus 5's
  $5/$25 per 1M)

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
