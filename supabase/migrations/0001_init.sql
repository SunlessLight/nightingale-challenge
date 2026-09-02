-- ============================================================
-- Nightingale — initial schema (7 tables)
-- Idempotent: safe to run the whole file again after a failure.
--
-- SAFETY: every table below enables RLS *and* declares explicit
-- policies in this same file. See CLAUDE.md invariant #7.
--
-- WRITE POSTURE: there are deliberately NO insert/delete policies
-- for `authenticated`. All writes go through Next.js server routes
-- using the secret key. Clients read; the server writes.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Helper functions
-- ------------------------------------------------------------

-- Staff/clinician/nurse identity comes from the JWT's app_metadata,
-- NOT from a roles table. A roles table read inside another table's
-- policy is the classic Supabase infinite-recursion footgun.
create or replace function public.is_staff()
returns boolean
language sql
stable
as $fn$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('staff', 'clinician', 'nurse'),
    false
  );
$fn$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;


-- ------------------------------------------------------------
-- 2. patient_sessions
--    `id` is the immutable internal identity. email/phone are
--    ordinary mutable columns hanging off it, so either contact
--    point can change without breaking history.
-- ------------------------------------------------------------

create table if not exists public.patient_sessions (
  id                     uuid primary key default gen_random_uuid(),
  auth_user_id           uuid unique references auth.users(id) on delete set null,
  email                  text,
  phone                  text,
  social_handles         jsonb       not null default '{}'::jsonb,
  consent_at             timestamptz,
  consent_clinic_name    text,
  marketing_consent_at   timestamptz,
  origin_lead_session_id uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on column public.patient_sessions.id is
  'Immutable internal identity. Never key anything off email or phone.';
comment on column public.patient_sessions.marketing_consent_at is
  'Separate from consent_at: care consent is not marketing consent.';


-- ------------------------------------------------------------
-- 3. lead_sessions (anonymous, pre-signup)
-- ------------------------------------------------------------

create table if not exists public.lead_sessions (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            text not null,
  source_channel       text not null
    check (source_channel in ('staff_referral','social_comment',
                              'instagram_ad_click','google_ad_click','website_widget')),
  campaign_id          text,
  creative             text,
  identity_level       text not null default 'anonymous'
    check (identity_level in ('anonymous','contactable','identified')),
  landing_timestamp    timestamptz not null default now(),
  page_context         jsonb       not null default '{}'::jsonb,
  staff_referral_topic text,
  converted_patient_id uuid references public.patient_sessions(id) on delete set null,
  expires_at           timestamptz not null default (now() + interval '30 days'),
  created_at           timestamptz not null default now()
);

-- The two session tables reference each other. Postgres cannot create
-- a circular FK inline, so this direction is added after both exist.
do $mig$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'patient_sessions_origin_lead_session_id_fkey'
  ) then
    alter table public.patient_sessions
      add constraint patient_sessions_origin_lead_session_id_fkey
      foreign key (origin_lead_session_id)
      references public.lead_sessions(id) on delete set null;
  end if;
end
$mig$;


-- ------------------------------------------------------------
-- 4. messages
--    session_id is polymorphic (see session_type). Postgres cannot
--    FK-enforce a column pointing at two tables; that integrity is
--    enforced in application code. Deliberate trade-off — see brief.
-- ------------------------------------------------------------

create table if not exists public.messages (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null,
  session_type        text not null check (session_type in ('lead','patient')),
  role                text not null check (role in ('user','assistant','system')),
  content             text not null,
  redacted_content    text,
  risk_level          text check (risk_level in ('low','medium','high')),
  risk_reason         text,
  confidence          numeric(3,2) check (confidence >= 0 and confidence <= 1),
  risk_provenance     jsonb,
  audio_transcript_id text,
  created_at          timestamptz not null default now()
);

comment on column public.messages.redacted_content is
  'The ONLY form of this message permitted to leave our server for the LLM.';
comment on column public.messages.risk_provenance is
  'jsonb: {"source":"keyword"|"llm","matched":"...","at":"<timestamp>"}. Recording the deciding layer is what proves the keyword net fired independently of the model (CLAUDE.md invariant #2).';
comment on column public.messages.audio_transcript_id is
  'Voice readiness. Unused in this build; costs nothing to carry now.';


-- ------------------------------------------------------------
-- 5. profile_items (Living Memory)
-- ------------------------------------------------------------

create table if not exists public.profile_items (
  id                 uuid primary key default gen_random_uuid(),
  patient_session_id uuid not null references public.patient_sessions(id) on delete cascade,
  category           text not null
    check (category in ('chief_complaint','symptom','medication','allergy')),
  value              text not null,
  status             text not null default 'active'
    check (status in ('active','stopped','resolved','unconfirmed')),
  provenance_pointer uuid not null references public.messages(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column public.profile_items.provenance_pointer is
  'ON DELETE RESTRICT is deliberate: a message that a fact depends on cannot be deleted. Losing the message loses the provenance.';
comment on column public.profile_items.status is
  'Corrections mutate status (e.g. stopped), never delete the row.';

drop trigger if exists profile_items_set_updated_at on public.profile_items;
create trigger profile_items_set_updated_at
  before update on public.profile_items
  for each row execute function public.set_updated_at();


-- ------------------------------------------------------------
-- 6. escalations
-- ------------------------------------------------------------

create table if not exists public.escalations (
  id                    uuid primary key default gen_random_uuid(),
  triggering_message_id uuid not null references public.messages(id) on delete restrict,
  patient_session_id    uuid references public.patient_sessions(id) on delete set null,
  triage_summary        jsonb not null default '[]'::jsonb,
  profile_snapshot      jsonb not null default '[]'::jsonb,
  acquisition_context   jsonb not null default '{}'::jsonb,
  status                text not null default 'pending'
    check (status in ('pending','acknowledged','responded','closed')),
  clinician_response    text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.escalations.profile_snapshot is
  'Snapshot, not a live join: the clinician must see what was true at send time, even if the patient edits their profile afterwards.';

drop trigger if exists escalations_set_updated_at on public.escalations;
create trigger escalations_set_updated_at
  before update on public.escalations
  for each row execute function public.set_updated_at();


-- ------------------------------------------------------------
-- 7. funnel_events  (PHI-free analytics)
-- ------------------------------------------------------------

create table if not exists public.funnel_events (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null,
  session_type text not null check (session_type in ('lead','patient')),
  event_type   text not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on column public.funnel_events.metadata is
  'PHI-FREE ONLY. Counts, channel ids, timings. Never symptom text.';


-- ------------------------------------------------------------
-- 8. audit_logs
-- ------------------------------------------------------------

create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid,
  action        text not null,
  resource_type text not null,
  resource_id   uuid,
  created_at    timestamptz not null default now()
);

comment on table public.audit_logs is
  'There is NO content column here, by design (CLAUDE.md invariant #6). Do not add one. Log what happened, never what was said.';


-- ------------------------------------------------------------
-- 9. Indexes
-- ------------------------------------------------------------

create index if not exists idx_lead_sessions_clinic_channel
  on public.lead_sessions (clinic_id, source_channel);
create index if not exists idx_lead_sessions_landing
  on public.lead_sessions (landing_timestamp desc);
create index if not exists idx_patient_sessions_auth_user
  on public.patient_sessions (auth_user_id);
create index if not exists idx_messages_session
  on public.messages (session_type, session_id, created_at);
create index if not exists idx_messages_risk
  on public.messages (risk_level) where risk_level in ('medium','high');
create index if not exists idx_profile_items_session
  on public.profile_items (patient_session_id, category);
create index if not exists idx_escalations_status
  on public.escalations (status, created_at desc);
create index if not exists idx_funnel_events_type
  on public.funnel_events (event_type, created_at desc);
create index if not exists idx_audit_logs_actor
  on public.audit_logs (actor_id, created_at desc);


-- ------------------------------------------------------------
-- 9b. Table-reading helper functions
--
-- ORDERING IS LOAD-BEARING — do not move these back to the top.
-- A `language sql` function body is parsed and resolved at CREATE
-- time, so these cannot be declared before the tables they select
-- from. (`language plpgsql` is only syntax-checked, which is why
-- set_updated_at can live up in section 1.)
-- ------------------------------------------------------------

-- security definer: these are called from INSIDE policies on other
-- tables, so they must bypass RLS on patient_sessions or they would
-- return false for the very rows they are meant to authorise.
-- search_path is pinned to prevent search_path hijacking.
create or replace function public.owns_patient_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.patient_sessions ps
    where ps.id = p_session_id
      and ps.auth_user_id = auth.uid()
  );
$fn$;

create or replace function public.session_is_consented(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.patient_sessions ps
    where ps.id = p_session_id
      and ps.consent_at is not null
  );
$fn$;

-- ------------------------------------------------------------
-- 10. Row Level Security — enable + policies, together
-- ------------------------------------------------------------

alter table public.lead_sessions    enable row level security;
alter table public.patient_sessions enable row level security;
alter table public.messages         enable row level security;
alter table public.profile_items    enable row level security;
alter table public.escalations      enable row level security;
alter table public.funnel_events    enable row level security;
alter table public.audit_logs       enable row level security;

-- Postgres has no CREATE POLICY IF NOT EXISTS, hence drop-then-create.

-- lead_sessions: anonymous by nature, so there is no owner to match.
-- Guest traffic is served by the server (secret key); staff may review.
drop policy if exists lead_sessions_staff_read on public.lead_sessions;
create policy lead_sessions_staff_read on public.lead_sessions
  for select to authenticated using (public.is_staff());

-- patient_sessions
drop policy if exists patient_sessions_own_read on public.patient_sessions;
create policy patient_sessions_own_read on public.patient_sessions
  for select to authenticated using (auth_user_id = auth.uid());

drop policy if exists patient_sessions_own_update on public.patient_sessions;
create policy patient_sessions_own_update on public.patient_sessions
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists patient_sessions_staff_read on public.patient_sessions;
create policy patient_sessions_staff_read on public.patient_sessions
  for select to authenticated
  using (public.is_staff() and consent_at is not null);

-- messages
drop policy if exists messages_own_read on public.messages;
create policy messages_own_read on public.messages
  for select to authenticated
  using (session_type = 'patient' and public.owns_patient_session(session_id));

drop policy if exists messages_staff_read on public.messages;
create policy messages_staff_read on public.messages
  for select to authenticated
  using (
    public.is_staff()
    and (session_type = 'lead' or public.session_is_consented(session_id))
  );

-- profile_items
drop policy if exists profile_items_own_read on public.profile_items;
create policy profile_items_own_read on public.profile_items
  for select to authenticated
  using (public.owns_patient_session(patient_session_id));

drop policy if exists profile_items_staff_read on public.profile_items;
create policy profile_items_staff_read on public.profile_items
  for select to authenticated
  using (public.is_staff() and public.session_is_consented(patient_session_id));

-- escalations
drop policy if exists escalations_own_read on public.escalations;
create policy escalations_own_read on public.escalations
  for select to authenticated
  using (public.owns_patient_session(patient_session_id));

drop policy if exists escalations_staff_read on public.escalations;
create policy escalations_staff_read on public.escalations
  for select to authenticated using (public.is_staff());

drop policy if exists escalations_staff_update on public.escalations;
create policy escalations_staff_update on public.escalations
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- funnel_events / audit_logs: staff read only. Written server-side.
drop policy if exists funnel_events_staff_read on public.funnel_events;
create policy funnel_events_staff_read on public.funnel_events
  for select to authenticated using (public.is_staff());

drop policy if exists audit_logs_staff_read on public.audit_logs;
create policy audit_logs_staff_read on public.audit_logs
  for select to authenticated using (public.is_staff());
