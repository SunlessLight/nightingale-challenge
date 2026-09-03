# Nightingale Timeline

> Ship log + pending TODO. Two rules:
> 1. A completed phase gets **4-6 terse bullets** — what shipped, not how it works.
>    Architecture belongs in [CLAUDE.md](CLAUDE.md).
> 2. Anything **removed or rejected keeps a one-liner**, so it isn't re-added by a later session.

**Deadline:** Thurs Sep 3, 2026, 1:00 PM SGT/MYT.
**The per-phase hours below were rewritten on Sep 3 at 09:00** to fit the 4 hours that
actually remain. The SCHEDULE table in the handoff is the authority.

---

# 📍 HANDOFF — read this first (updated Sep 3, 2026, ~10:15, Phase 4 DONE)

## Where we are

**Phases 0-4 are done.** Phase 4 — the highest-graded section — is fully wired and verified
end to end against the real API and the real database. **Next up is Phase 5 (Send to Clinic),
then Phase 6 (tests), then Phase 7 at the 12:00 hard stop.**

**Phase 4 came in at ~10:15 against its 11:15 box** (libraries ~20 min the night before,
wiring ~45 min). That leaves Phase 5 and 6 with more room than the schedule assumed. Building
still stops at 12:00 MYT.

Live: https://nightingaleai-challenge.vercel.app — verified anonymously by curl, not from
Evan's logged-in browser.

## ✅ Phase 4 — exact state: DONE (was the STOP block; kept only as the record)

Wired and verified in `c264fd8`. **126 tests green, `npm run build` green.** The libraries
(`risk.ts`, `profile.ts`) were already done; this session added the plumbing and measured it.

**`askClaudeIntake()` is now proven against the real API** — the one thing the previous
handoff flagged as unverified. Forced `tool_choice` + `output_config: {effort:"medium"}` on
`claude-opus-5` does **not** 400. Measured: 4.6–5.3s, ~1190 in / ~375 out tokens,
**$0.0152 per intake turn** (~1.8× a guest message; output tokens are 60% of the bill at
5× the input price). Doing reply + risk + extraction as three calls would roughly triple it.

## ⏱ SCHEDULE — the budget no longer fits. Read this before writing code.

Measured at 08:58 MYT on Sep 3: **4h 1m to the deadline**, against **8h** of remaining
budgeted work (Phases 3-7). Phase 2 came in at 35 min against 2.0h, but the overnight gap ate
the buffer. Roughly half the remaining scope has to go.

**Evan chose this plan (Sep 3, ~09:00). Do not re-litigate it:**

| Time (MYT) | Phase | Trimmed to |
|---|---|---|
| 09:00-09:45 | 3 — auth + consent + conversion | Minimum viable. Consent checkbox + guest→patient carry-over. |
| 09:45-11:15 | **4 — risk gating + memory** | **PROTECTED. Do not cut.** Highest-graded section. |
| 11:15-11:45 | 5 — Send to Clinic | Warm-lead view dropped (first on the cut list) |
| 11:45-12:00 | 6 — the 8 required tests | Simplified; **2 of 8** already written in Phase 2 |
| **12:00** | **HARD STOP on building** | |
| 12:00-13:00 | 7 — README, technical brief, video, email | Non-negotiable. An unsubmitted project scores zero. |

If a phase overruns, take the time out of Phase 5 or 6 — never Phase 4, never Phase 7.

## ⚠️ RESOLVED in Phase 3 — the Supabase auth trap (kept for the brief)

**Do NOT use `supabase.auth.signUp()` from the browser.** Measured on Sep 3 ~09:00 against
the real project:

- `probe@example.com` → `400 Email address is invalid`. Supabase blocklists `example.com`,
  so synthetic test emails need a domain that survives its validator.
- `probe@nightingale-demo.co` → also `400 ... is invalid`.
- Two further attempts → `429 email rate limit exceeded`.

*Measured:* the 400s and the 429s above, and that **0 auth users** exist in the project, so
none of the probes created anything.
*Inferred, not measured:* the 429 says "**email** rate limit", which implies Supabase tried to
send a confirmation mail — i.e. **Confirm email is ON**, the default. If so, `signUp()` returns
`session: null` and the new patient is never logged in, which breaks conversion and the demo.

**The fix that shipped — no dashboard action, no email, no rate limit. Worked first try:**

```ts
// server-side only, in a route handler
const { data } = await supabaseAdmin().auth.admin.createUser({
  email, password, email_confirm: true,   // marks it confirmed WITHOUT sending mail
});
// then sign the browser in normally:
await supabasePublic().auth.signInWithPassword({ email, password });
```

`admin.createUser` sends no email, so it is not rate limited, and it keeps the whole flow
inside code rather than depending on a toggle Evan has to remember. The alternative — Supabase
dashboard → Authentication → Sign In / Providers → Email → **Confirm email OFF** — also works
but costs a context switch and leaves a setting a future redeploy could surprise you with.

**Verify the choice before building on it:** create one synthetic patient, confirm
`auth.uid()` is non-null, and confirm the RLS policy `patient_sessions_own_read` actually
returns that row for the logged-in user and nothing for a stranger. RLS failures are silent.

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

## Time budget — superseded

The original 10.0h envelope for Phases 2-7 is dead. See the SCHEDULE table above, which is
the live plan. Cut order when something slips is still the list at the top of this file, and
**never cut from Phase 4**.

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
- **Do not write `.ts`/`.tsx` files with a bash heredoc.** Measured in Phase 2: an escaped
  backslash-b inside a template literal arrived in the file as a *single* backslash-b, which
  JavaScript reads as the backspace escape rather than a regex word boundary, so the regex
  matched nothing and threw no error. (This bullet lost the same character twice while being
  written, which is the point.) A second attempt with two heredocs of JSX failed to parse at
  all and wrote no files. Use the Write tool for code; heredocs are fine for prose.
- **Supabase's JS client types the `select()` string at compile time.** A runtime-concatenated
  column list defeats that and TS infers `GenericStringError`. Either inline the string literal
  or cast `as unknown as Row`. See `LEAD_COLUMNS` in `src/lib/leadSessions.ts`.
- **Something has been squatting on port 3000** (a stale `next dev`, serving 500s). Phase 2
  verification ran on `npx next start -p 3001` to avoid killing Evan's process. If `npm run
  dev` behaves oddly, check `netstat -ano | grep :3000` first.

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
- **`auth.signUp()` is a trap** — blocklisted domains, a low email rate limit, and (inferred)
  email confirmation ON. See "DO THIS FIRST in Phase 3" above before writing any auth code.
- **jsonb filtering works.** `.contains("metadata", { clinic_id })` maps to the `@>` operator
  and was exercised in production in Phase 2. The planned JS-side fallback was not needed.

## Open decisions awaiting Evan

- **Living-memory corrections match on the model-authored value STRING** — measured failure in
  Phase 4: the model wrote "Advil ... — stopped last week" as the *value*, `matchKey()` missed,
  and the correction inserted a duplicate rather than changing status. Hardened with an explicit
  value-reuse instruction in the intake prompt and re-verified working, but a prompt is
  probabilistic. **The structural fix is to send the model each item's `id` in the profile
  context and have it echo the id back**, turning a fuzzy string join into an exact key. Not done
  — it touches `profile.ts`'s tested contract and the schedule did not have room. Evan's call.

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
  $5/$25 per 1M). Phase 4 measured the intake call at 4.6-5.3s cold and **7.6s** on a turn
  carrying 3 messages of history plus a profile — the ceiling to watch, since context grows
  every turn. Still fine behind a typing indicator; `maxDuration = 60` on both chat routes.

## Before submission

- **Delete or auth-gate `/api/smoke`.** It is public and, with `?run=llm`, billable.
- Set a monthly spend cap in the Anthropic Console — the backstop that survives a code bug.

## Prompt to start a fresh session

```
Read these, in this order, then execute:
  1. CLAUDE.md      (safety invariants - non-negotiable)
  2. timeline.md    (this file: the HANDOFF and the SCHEDULE table)

We are on Phase 5 (Send to Clinic), then Phase 6 (the 8 tests). Do not spawn
subagents.

Phase 4 is DONE and verified - do not redo or redesign it. risk.ts,
profile.ts, messages.ts, /api/patient/chat, PatientChat and ProfilePanel are
all wired, measured against the real API and the real database, and committed
in c264fd8. 126 tests green, npm run build green.

Building stops at 12:00 MYT so the README, brief, video and email get their
hour. I already chose that plan - do not re-open it.

Already done - do not redo:
- Phases 0-4 shipped. Four channels, redaction enforced by a branded
  `Redacted` type, real value_event count, guest->patient conversion with
  provenance intact, RLS proven four ways, risk gating writing all four risk
  columns, and living memory with provenance rendered on the patient page.
- askClaudeIntake() IS proven against the real API: forced tool + effort
  medium on claude-opus-5 works, 4.6-5.3s, ~$0.0152/turn.

Phase 5 is Send to Clinic: on Medium/High risk, one button that persists an
escalation row (triggering message + 1-5 bullet triage summary + profile
snapshot + acquisition context), confirms "response in 12-18 hours", and lets
the chat continue. The escalations table and its RLS already exist. The
warm-lead view is already cut - do not build it.

Known open item, my call to make - do not fix it silently: living-memory
corrections currently match on the model-authored value STRING, so a value
that drifts by one clause inserts a duplicate instead of changing status. A
prompt instruction makes the model reuse the value verbatim and it was
re-verified working, but that is probabilistic, not structural. The
structural fix is to have the model echo back a stable item id.

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
- Tell me plainly when I need to do something myself, and when I don't. I do
  NOT want to be sent to a dashboard unless it is genuinely unavoidable.

When Phase 5 is done: npm test, npm run build, click it through, verify
anonymously against the deployed URL, commit, update timeline.md, then Phase
6. Phase 7 starts at 12:00 no matter what is unfinished.
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

## Phase 3 — Auth + consent + conversion — ✓ DONE (see Shipped, below)

## Phase 4 — Intake + risk gating + memory — ✓ DONE (see Shipped, below)

## Phase 5 — Send to Clinic (**11:15-11:45, 30 min**)

- [ ] On Med/High risk: one clear button
- [ ] Escalation persists triggering message + 1-5 bullet triage summary + profile snapshot + provenance + acquisition context
- [ ] Confirmation + "response in 12-18 hours"; chat continues after sending
- [ ] Warm-lead view reduced to a **minimal read-only list** (first thing to cut)

## Phase 6 — The 8 required tests (**11:45-12:00, 15 min**)

Simplified versions are explicitly fine — they check that the cases were thought about.

- [x] guest→patient conversion — `tests/conversion.test.ts` (Phase 3), consent gate
- [x] value_event accuracy — `tests/valueEvents.test.ts` (Phase 2)
- [ ] escalation payload
- [ ] risk escalation (chest pain case)
- [ ] memory mutation + provenance
- [x] redaction — `tests/redaction.test.ts` (Phase 2), incl. a runtime assertion on the bytes
      actually handed to the model
- [ ] access control — the *live* proof exists (Phase 3, prod); still needs a test file
- [ ] "are you a real doctor?" honesty test

## Phase 7 — README + technical brief + demo video (**12:00-13:00, hard start**)

- [ ] README: setup/run/test steps, **where redaction happens**, **how RBAC is enforced**
- [ ] `docs/TECHNICAL_BRIEF.md`: architecture, data schema, channel ethics green/yellow/red table, assumptions, trade-offs/cuts, voice-AI future notes
- [ ] ATTRIBUTION.txt final pass (append as each dep is added — don't reconstruct at 3am)
- [ ] 3-minute demo video: Scenario A then Scenario B. Record from the **deployed URL in an
      incognito window** — nothing to configure in Vercel, it deploys on push. The whole
      remaining window is inside clinic hours (08:00-21:00 MYT), so the channel-specific
      greetings show automatically; the after-hours variant is not a risk today.
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

### ✓ Phase 4 — Intake + risk gating + living memory (Sep 3, 2026, 09:57-10:15 MYT)

- **`askClaudeIntake()` proven against the real API before any UI was built on it** — the one
  unverified thing in the handoff. Forced `tool_choice` + `output_config: {effort:"medium"}` on
  `claude-opus-5` does **not** 400. Measured 4.6–5.3s and **$0.0152/intake turn**; the reply,
  the risk judgement and the fact extraction all ride one round trip
- **One write path for `messages`** (`src/lib/messages.ts`) shared by both chat routes, so the
  four risk columns cannot be written by one route and forgotten by the other.
  `insertLeadMessage()` delegates to it. Verified in the DB: risk lands on **user** rows,
  assistant rows stay null
- **Invariant #2 measured in both directions.** Keyword-only: "crushing chest pain" →
  `source: "keyword"`, `confidence: 1`, `llm_level: null`. Model escalation: "the pain has
  settled now" has **no** keyword hit, and the model raised it to high from history →
  `source: "llm"`, `keyword_level: null`. Risk is decided on the RAW text, not the redacted text
- **Risk is stored BEFORE the model call** (keyword-only), then upgraded with
  `max(keyword, llm)` after. A safety net that only exists after a successful network call is
  not a safety net — and on a 502 the route still returns the keyword verdict so the emergency
  banner renders with the model unreachable
- **Access control on a route that bypasses RLS.** `/api/patient/chat` holds the admin key, so
  `authorizePatientSession()` verifies the bearer token against `patient_sessions.auth_user_id`.
  Proven: cross-patient **404**, no token **401**, garbage token **401**, own session **200**.
  `profile_items` RLS proven four ways; the ProfilePanel reads only through the patient's own
  RLS-bound client
- **Verified anonymously against the deployed URL**, not from a logged-in browser: `/start`
  302s, guest chat returns `risk.level: "high"`, conversion carries 3 messages, a real intake
  turn runs the forced-tool call on Vercel, and `/api/patient/chat` with no token is **401**.
  Prod profile read back through the anon key + patient JWT (RLS), not the admin key.
  **Prod intake latency 11.2s** end-to-end from a laptop — vs 7.6s locally; `maxDuration = 60`
  covers it, but that is the number the demo video will show
- **Living memory rendered with provenance** — items grouped by `CATEGORY_LABELS`, each showing
  its status chip and the sentence behind it, resolved via `provenance_pointer`

**Bug found by measurement, not by review — worth keeping:** the model appended
"— stopped last week" *into the fact's value*, so `matchKey()` missed and the correction
**inserted a second row**, leaving the record saying the patient was both taking and not taking
Advil. `profile.ts` was correct throughout (it never deleted — there is still no delete case).
The real lesson is that **matching on a model-authored free-text value is a soft join**: a value
that drifts by one clause silently becomes a new fact, and for a clinician a duplicated
contradiction is worse than an absence. Fixed by making the value-reuse contract explicit in the
intake prompt; re-verified on a fresh patient — one row, id unchanged, `active` → `stopped`,
`created_at` 02:11:05 vs `updated_at` 02:11:14. **Residual risk: this fix is a prompt
instruction, so it is probabilistic, not structural.** The structural fix (match on a stable id
the model echoes back, rather than on the value text) is written up in Phase 5/6 notes below.


### ✓ Phase 3 — Auth + consent + guest→patient conversion (Sep 3, 2026, 09:12-09:30 MYT)

- **Conversion re-points messages, it does not copy them.** `carryMessages()` UPDATEs
  `session_id` + `session_type='patient'`, so `messages.id` and `created_at` are byte-identical
  after conversion and `profile_items.provenance_pointer` still resolves to the ORIGINAL guest
  utterance. Verified in prod: message `8328bfc4…` kept its id and its `created_at` of
  01:18:16, twelve seconds *before* the 01:18:28 consent
- **The `session_type` flip is load-bearing, not cosmetic.** `messages_own_read` is
  `session_type='patient' AND owns_patient_session(...)`. Left as lead rows (what the old
  handoff suggested) the patient cannot read their own history through the RLS-bound client
- **Auth via `admin.createUser({ email_confirm: true })` on the server** — worked first try,
  no email sent, no rate limit, no dashboard toggle. Browser `signUp()` was never used
- **Consent is server-enforced and must be the literal `true`.** `"true"`, `1` and `{}` are all
  rejected with 422 — verified against production, not just in tests. Marketing consent is a
  separate optional timestamp; both were stored independently in the prod row
- **`/patient/[id]` reads only through the patient's own anon+JWT client.** The admin key never
  touches that page, and the page runs the signed-out query live as a visible negative control
- **Access control proven four ways against the real DB** (local *and* prod): the patient reads
  their own row + 3 carried messages; a signed-out stranger reads 0 from `messages`,
  `patient_sessions` and `lead_sessions`; a *second logged-in patient* reads 0 of patient #1
  and 1 of their own. 50 tests green (was 37); `npm run build` green
- **New trap found:** `requireEnv()` is unusable in browser code — it indexes `process.env`
  dynamically and Next.js inlines only *literal* `process.env.NEXT_PUBLIC_X`. Verified the
  public URL IS in the prod client bundle and neither secret is
- Additive: `funnel_events` gained a `consent_granted` event type, logged on the PATIENT
  session with the originating channel, so a signup joins back to the ad that earned it

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
- 37 tests green (was 6) across 4 suites; two of Phase 6's eight required tests (redaction,
  value_event accuracy) are pre-paid. `npm run build` green. Verified **anonymously by curl against the
  deployed URL** — all four channels 302, guest page 200, chat 200, and the production row
  read back out of Supabase shows raw PII in `content` and masked text in `redacted_content`.
  Latency ~5.8–6.7s in production (~5.1–5.8s local); **~$0.0085/message** (703 in / 199 out
  at Opus 5's $5/$25 per 1M)

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
