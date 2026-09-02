# Nightingale — Clinic Inquiry → AI Intake → Clinician Handoff

> **Status: in progress.** Filled in during Phase 7. Headings below are the ones the brief grades.

A secure web app that catches a potential patient the moment they engage with a clinic on
social, gives them something useful for free, converts them to a consented patient session,
runs a safe non-diagnostic AI intake chat with two-layer risk gating, and hands off to a
clinician with full context.

**Live demo:** _TODO — Vercel URL_
**Demo video (3 min):** _TODO_

## Setup

_TODO — clone, `npm install`, copy `.env.example` → `.env.local`, fill Supabase + Anthropic keys._

## Running

```bash
npm run dev
```

_TODO — Supabase migrations, seeding synthetic data._

## Running the tests

```bash
npm test
```

_TODO — list the 8 required tests and what each proves._

## Where redaction happens

_TODO — the single choke point every LLM-bound string passes through, what patterns it strips
(names, IC/ID numbers, phone numbers), and why `content` and `redacted_content` are stored
separately._

## How access control (RBAC) is enforced

_TODO — Supabase Row-Level Security: enforced server-side at the database, not in the client.
A patient may only read their own rows; staff/clinician/nurse roles read consented patients.
Note that every table has RLS enabled at creation time._

## Safety model

_TODO — the keyword safety net, why the LLM may escalate but never de-escalate, the
non-diagnostic constraint, and the emergency disclaimer._

## Architecture

_TODO — one paragraph + pointer to [docs/TECHNICAL_BRIEF.md](docs/TECHNICAL_BRIEF.md)._

## Attribution

See [ATTRIBUTION.txt](ATTRIBUTION.txt).
