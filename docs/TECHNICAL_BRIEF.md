# Nightingale — Technical Brief

> **Status: stub.** Written in Phase 7. Target 2-3 pages. Headings below are the ones the
> brief requires — do not drop one.

**Author:** Evan Yeoh · **Date:** September 2026

## 1. Architecture

_TODO — the request path end to end: channel entry → LeadSession → value_event → consent →
PatientSession → intake chat → risk gating → escalation. Name where each piece runs
(client / Next.js server / Supabase / Anthropic) and why._

## 2. Data schema

_TODO — the 7 tables, the relationships between them, and the three decisions worth
defending: mutable contact points on an immutable internal id; `provenance_pointer` surviving
guest→patient conversion; `audit_logs` having no content column by design._

## 3. Channel ethics — green / yellow / red

Every channel idea is classified on 4 axes: **technically possible** / **legal under Malaysian
PDPA + MAB healthcare-advertising rules** / **allowed by platform policy** / **trust-compatible**.
Only green channels are built. A red channel, even well-coded, loses points.

| Channel idea | Possible | Legal (PDPA/MAB) | Platform-allowed | Trust-compatible | Verdict |
|---|---|---|---|---|---|
| _TODO: staff referral_ | | | | | 🟢 |
| _TODO: social comment reply_ | | | | | 🟢 |
| _TODO: ad click (IG/Google)_ | | | | | 🟢 |
| _TODO: website widget_ | | | | | 🟢 |
| _TODO: scraping competitor reviews_ | | | | | 🔴 |
| _TODO: DMing health forum threads_ | | | | | 🔴 |
| _TODO: condition-based retargeting_ | | | | | 🔴 |

## 4. Safety & risk gating

_TODO — two-layer design, why the keyword layer is independent of and outranks the LLM,
how ambiguity is handled without false reassurance, and the non-diagnostic constraint._

## 5. Assumptions

_TODO — e.g. simulated channels rather than live platform APIs; synthetic data only;
single-clinic tenancy._

## 6. Trade-offs and deliberate cuts

_TODO — name each cut and why it was the right one to cut. See the "Deliberate cuts" section
of timeline.md. Naming a cut deliberately scores better than silently omitting it._

## 7. Voice AI — future notes

_TODO — `messages.audio_transcript_id` is already in the schema. Describe what a voice intake
path would add (transcription boundary, where redaction moves to, latency budget) and what
would need to change in the risk gate when input is speech rather than typed text._
