# Nightingale Timeline

> Ship log + pending TODO. Two rules:
> 1. A completed phase gets **4-6 terse bullets** — what shipped, not how it works.
>    Architecture belongs in [CLAUDE.md](CLAUDE.md).
> 2. Anything **removed or rejected keeps a one-liner**, so it isn't re-added by a later session.

**Deadline:** Thurs Sep 3, 2026, 1:00 PM SGT/MYT.
**Budget below is ~11h and has zero slack** — it replaces the BUILD_PLAN's ~24h estimate.

---

# 📍 HANDOFF — read this first (updated Sep 2, 2026, mid-Phase-1)

## Where we are

**Phase 0 scaffold: done and committed.** Phase 1 is **in progress, not finished.**

Accounts and keys are set up *outside* the repo, so a fresh session cannot see them:

| Thing | State |
|---|---|
| Supabase project | ✅ Created ("enable RLS for all tables" ticked at creation) |
| Supabase URL + publishable key + secret key | ✅ In local `.env` (gitignored — verified untracked) |
| Anthropic API key | ✅ In local `.env` |
| Vercel account + repo imported | ✅ Done via GitHub |
| **`0001_init.sql` actually RUN in Supabase** | ❌ **NOT YET — this is where Evan stopped** |
| **`verify_rls.sql` run** | ❌ Not started |
| **Vercel environment variables added** | ❌ Not done — see below |
| Next.js scaffold (`package.json` etc.) | ❌ Not started — repo is still docs + SQL only |

## Immediate next steps, in order

1. **Run [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql)** — paste the whole file into the Supabase SQL Editor. It is **idempotent**: if it errors partway, fix the error and re-run the *entire file*. Do not hand-patch a half-built database.
2. **Run [supabase/verify_rls.sql](supabase/verify_rls.sql)** — expect **7 rows, every `rls_enabled = true`, every `policies >= 1`**. This is the evidence for safety invariant #7.
3. **Add the 4 env vars in Vercel** → Project → Settings → Environment Variables, ticked for Production + Preview + Development:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`.
   The local `.env` is gitignored and **never reaches Vercel** — that is by design, not a bug. Env vars are read at *build* time, so redeploy after adding them.
4. **Scaffold Next.js at the repo root** and get a hello-world live on Vercel.

## Open decisions awaiting Evan

- **Supabase GitHub integration** — recommended **disconnected**. It auto-runs migrations on every push to `main`, which will collide with the manual SQL-Editor path above ("table already exists") and turns a typo into a 3am CI debug. Unconfirmed whether Evan disconnected it.
- **Two additive columns** were added beyond the locked CLAUDE.md schema, both to make RLS policies expressible: `escalations.patient_session_id` and `funnel_events.session_type`. Keep unless Evan objects.
- **`messages.risk_provenance` is `jsonb`**, not the bare timestamp the brief names — it carries `{"source":"keyword"|"llm","matched":…,"at":…}` so the deciding layer is recorded. This is the evidence for safety invariant #2. Superset of the brief; revertible.

## Known traps

- **`create-next-app` may overwrite `.gitignore`.** Immediately after scaffolding, run `git check-ignore -v .env` and confirm it is still ignored. A leaked key cannot be un-leaked from git history.
- **The first Vercel deploy will fail** — there is no `package.json` yet. Expected, not a bug. It goes green after the scaffold.
- **Staff role lives in the JWT**, not a table (`is_staff()` reads `app_metadata.role`). After granting the role via SQL, the account **must sign out and back in** or `is_staff()` stays false.
- **RLS failures are silent** — an empty array, no error. When a query returns nothing, "did I write a policy for that table?" is the first thing to check, not the tenth.

## Prompt to start a fresh session

```
Read timeline.md, including the HANDOFF section, and continue Phase 1.

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

- [ ] Scaffold Next.js at repo root (no subfolder)
- [ ] Supabase project + the 7 tables — **SQL already written**: paste `supabase/migrations/0001_init.sql` into the SQL Editor, then run `supabase/verify_rls.sql` and confirm 7 rows, all `rls_enabled = true`, all `policies >= 1`
- [ ] `.env.example` committed; real `.env.local` never staged
- [ ] Deploy to Vercel **immediately** — something must always be live
- [ ] Anthropic API key wired, one smoke call proven

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
