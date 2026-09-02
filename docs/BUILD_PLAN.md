# Nightingale 48-Hour Build — Plan

**Challenge:** Build a secure "first clinic inquiry → authenticated AI intake chat → clinician handoff" web app.
**Full spec:** [2026 48 Hour Build_ Nightingale Candidate Brief.pdf](2026%2048%20Hour%20Build_%20Nightingale%20Candidate%20Brief.pdf) (read this in full — this file is a summary + plan, not a replacement)
**Deadline:** Thurs Sep 3, 2026, 1:00 PM SGT/MYT
**Submit to:** irakumar@ntngale.com (cc yunxint@sunway.edu.my), subject "Nightingale 48HR Build — Evan Yeoh"
**Builder:** Evan, solo, first time building something this technical — plan below is deliberately scoped down for that.

---

## What it is, in plain English

A clinic loses potential patients because when someone comments/messages on Instagram, TikTok, Google, etc., nobody replies fast enough or the sign-up feels invasive. The app must:

1. Catch that person the instant they engage (a "LeadSession" — anonymous, no signup).
2. Give them something genuinely useful for free (a "value_event").
3. Once they trust it, invite them to sign up + consent → becomes a "PatientSession" (identified).
4. Chat with them safely about their concern (never diagnose, never miss an emergency phrase).
5. Extract structured facts into a live "Patient Profile" (Memory) as the chat progresses.
6. Hand off to a real clinician when risk is Medium/High, carrying full context so the patient never repeats themselves.

Graded on: does this feel trustworthy and psychologically sound, not just "does the code run."

---

## Scope decisions (read this before building anything)

### Build (this is ~26 of 30 scored points)
- **Channels (need 4 total):** `staff_referral` (mandatory), `social_comment` (mandatory), `instagram_ad_click`/`google_ad_click` (just a URL query param, e.g. `?source=instagram_ad&campaign=ivf_over40`), `website_widget` (a chat bubble on a fake clinic homepage). All 4 are simulate-able — no real platform API needed. **Do not attempt real Meta/TikTok/WhatsApp integration.**
- LeadSession → PatientSession conversion, preserving attribution (clinic_id, source_channel, campaign_id, creative, identity_level, landing_timestamp) end to end.
- One value_event: the "N people asked this clinic a question this week" counter — must be a real count from the database, never a hardcoded/fake number (if it's 0, show nothing).
- PHI redaction before anything hits the LLM: regex for structured patterns (ID numbers, phone numbers) + swap a small fixed list of fake synthetic names. Good enough — don't over-engineer this.
- Channel rules as one config file/table (channel × identity_level × time_of_day → opening message) — not scattered if-statements.
- Auth + consent (Supabase auth is fine), migrating guest context into the patient record without re-asking anything.
- Patient intake chat with **two-layer risk gating**:
  1. Hardcoded keyword safety net — instantly flags High risk on: "crushing chest pain", "difficulty breathing", "heavy bleeding", "want to hurt myself" (and close variants). This must never be skippable by the LLM — it's a guaranteed catch, checked before/alongside the AI's own judgment.
  2. LLM layer for everything else — outputs risk_level (Low/Med/High), risk_reason, confidence, risk_provenance (timestamp). Ambiguous symptoms ("chest feels funny") must escalate or honestly say it's uncertain — never falsely reassure.
  3. Non-diagnostic always: no "you have X", no medication changes, no treatment plans beyond "consult a clinician." Visible disclaimer under the chat box: "If this is an emergency, exit Nightingale and dial 999."
- Living Memory profile: chief complaint, key symptoms (+ timeline), current medications, allergies. Each item has `value`, `status`, `provenance_pointer` (which message it came from), `updated_at`. Corrections update status (e.g. "stopped last week" → Advil marked Stopped, not deleted).
- Send to Clinic: on Med/High risk, one clear button persists triggering message + 1-5 bullet triage summary + profile snapshot + provenance + acquisition context. Shows confirmation + "response in 12-18 hours." Chat continues after sending.
- Access control: server-side enforced (Supabase Row-Level Security is the easiest path) — a patient can only ever read their own data; staff/clinician/nurse roles can read all consented patients.
- Audit logs: structured JSON, IDs/timestamps/event types only — **never raw message content**.
- The 8 required tests (simplified versions are fine — they're checking you thought about these cases, not enterprise test coverage): guest→patient conversion, value_event accuracy, escalation payload, risk escalation (chest pain case), memory mutation + provenance, redaction, access control, and the "are you a real doctor?" honesty test.
- Deliverables: README (setup/run/test steps, where redaction happens, how RBAC is enforced), a 2-3 page technical brief (architecture, data schema, channel ethics green/yellow/red table, assumptions, trade-offs/cuts, voice-AI future notes), ATTRIBUTION.txt, 3-minute demo video.

### Explicitly skip (bonus-only — name them as deliberate cuts in the brief, don't attempt)
- Real Meta/TikTok/WhatsApp/Instagram API integration
- Composite lead-scoring with decay curves (use a simple, transparent point sum instead)
- Dormant-lead lifecycle (active → cooling → dormant → recall → suppressed)
- Conflict flagging on contradictions
- Intent-based channel rules
- `google_reviews` channel (needs a real reviews page — skip in favor of the 2 easier ones above)
- Full session-recovery edge cases (a working link with intact context is enough; don't chase every edge case)

**Ethics rule to bake into the technical brief:** classify any channel idea (e.g. scraping competitor reviews, DMing health forum threads, condition-based retargeting) on 4 axes — technically possible / legal under Malaysian PDPA + MAB healthcare-ad rules / allowed by platform policy / trust-compatible. Only ever build "green" ones. A red channel, even well-coded, loses points.

---

## Recommended tech stack

- **Next.js** — one project handles both the pages the user sees and the server-side logic behind them, instead of two separate codebases.
- **Supabase** — hosted database + built-in login/signup + Row-Level Security (a rule set once on the database itself: "a user may only ever see rows that belong to them"). This alone satisfies most of the Access Control requirement without hand-writing it.
- **Vercel** — hosting/deployment; gives TLS (the padlock/HTTPS) automatically.
- **Claude (Anthropic API)** — powers the chat, risk reasoning, and fact extraction.

Reasoning: this combination is extremely well-documented, so an AI coding assistant scaffolding it is far more likely to get it right on the first pass — important when Evan can't personally debug broken code.

---

## Phase-by-phase plan (~24hr budget — recalibrate against actual hours left)

1. **Setup (1-1.5h):** scaffold Next.js + Supabase, create core tables (LeadSession, PatientSession, Message, ProfileItem, Escalation), deploy a "hello world" to Vercel immediately so something is always live.
2. **Guest flow (3-4h):** 4 channel entry points, channel-rules config file, guest chat with redaction, the value_event counter.
3. **Auth + conversion (2-3h):** signup/login, consent checkbox, migrate guest context into patient record with no re-asking.
4. **Patient intake + risk gating + memory (5-6h, the core — give this the most time):** keyword safety net first (fast, testable, guarantees safety), then the AI layer for nuance + fact extraction.
5. **Send to Clinic + staff/nurse view (2-3h):** escalation record, simple login-gated warm-lead list.
6. **Tests (1.5-2h):** write against what was actually built.
7. **Docs + demo video (2-3h):** do this before exhaustion sets in — brief/demo quality is graded and easy to phone in badly late at night.
8. **Buffer (2h+):** something will break; don't schedule against zero slack.

If time runs short, cut from step 5 (nurse view) before cutting anything from step 4 (safety-critical).

---

## Key terms (for reference mid-build)

- **PWA** — a website built to feel/install like a native app.
- **Webhook** — an automatic real-time notification one system pushes to another (not used here — everything is simulated).
- **RBAC** — rules for who can see what, based on role (patient/staff/clinician).
- **Schema** — the blueprint for how data tables relate to each other.
- **Provenance** — a trail proving exactly which message/timestamp a fact came from.
- **Redaction** — stripping sensitive info (names, IDs, phones) before it reaches the AI or a log.
- **RLS (Row-Level Security)** — a database-enforced rule blocking a user from ever pulling someone else's data.
