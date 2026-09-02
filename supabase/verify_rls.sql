-- ============================================================
-- Run this in the Supabase SQL Editor AFTER 0001_init.sql.
-- This is the evidence for CLAUDE.md safety invariants #6 and #7.
--
-- ONE statement, on purpose. The Supabase SQL Editor renders only
-- the LAST result set when you paste multiple statements — so a
-- multi-query verification script silently hides its own findings.
-- Everything below unions into a single table you can read at once.
--
-- READ THE `status` COLUMN. Two rows at the top are the verdict;
-- everything under them is the supporting detail.
-- ============================================================

with rls as (
  select
    c.relname::text     as tbl,
    c.relrowsecurity    as rls_enabled,
    count(p.policyname) as policies
  from pg_class c
  left join pg_policies p
    on p.schemaname = 'public' and p.tablename = c.relname
  where c.relnamespace = 'public'::regnamespace
    and c.relkind = 'r'
  group by c.relname, c.relrowsecurity
),

-- The 7 tables CLAUDE.md locks. Listing them explicitly means a
-- MISSING table fails loudly instead of just not appearing.
expected(tbl) as (
  values ('lead_sessions'),('patient_sessions'),('messages'),
         ('profile_items'),('escalations'),('funnel_events'),('audit_logs')
),

audit_cols as (
  select column_name::text as col, data_type::text as typ, ordinal_position
  from information_schema.columns
  where table_schema = 'public' and table_name = 'audit_logs'
),

verdict as (
  select
    (select count(*) from expected e
       left join rls r on r.tbl = e.tbl
      where r.tbl is null or not r.rls_enabled or r.policies < 1) as rls_fail,
    (select count(*) from rls r
      where r.tbl not in (select tbl from expected)
        and (not r.rls_enabled or r.policies < 1))                as extra_fail,
    (select count(*) from audit_cols
      where col ~* '(content|message|body|note|transcript|symptom)') as audit_fail
)

-- 0. Verdict rows -------------------------------------------------
select 0 as seq, 'VERDICT' as check_name,
       'invariant #7 — RLS on every table' as subject,
       'expected 7 tables, all RLS on, all with >=1 policy' as detail,
       case when v.rls_fail = 0 and v.extra_fail = 0
            then '✓ PASS' else '✗ FAIL — see rows below' end as status
from verdict v
union all
select 0, 'VERDICT',
       'invariant #6 — audit_logs carries no content',
       'no content/message/body column permitted',
       case when v.audit_fail = 0 then '✓ PASS' else '✗ FAIL' end
from verdict v

-- 1. Per-table RLS detail ------------------------------------------
union all
select 1, '1. RLS + policies', e.tbl,
       coalesce('rls_enabled=' || r.rls_enabled::text
                 || ', policies=' || r.policies::text,
                'table not found'),
       case
         when r.tbl is null      then '✗ TABLE MISSING'
         when not r.rls_enabled  then '✗ RLS OFF — anon key can read this'
         when r.policies < 1     then '✗ NO POLICY — locked shut, returns []'
         else '✓'
       end
from expected e
left join rls r on r.tbl = e.tbl

-- Any table beyond the locked 7. A new table with no RLS is the
-- exact regression invariant #7 exists to catch.
union all
select 1, '1. RLS + policies', r.tbl,
       'UNEXPECTED table — rls_enabled=' || r.rls_enabled::text
         || ', policies=' || r.policies::text,
       case when r.rls_enabled and r.policies >= 1
            then '⚠ not in the locked schema, but secured'
            else '✗ UNSECURED TABLE' end
from rls r
where r.tbl not in (select tbl from expected)

-- 2. Policy inventory — eyeball who reads what ---------------------
union all
select 2, '2. Policy inventory', p.tablename::text,
       p.policyname::text || '  [' || p.cmd::text
         || ' → ' || array_to_string(p.roles, ',') || ']',
       '·'
from pg_policies p
where p.schemaname = 'public'

-- 3. audit_logs columns --------------------------------------------
union all
select 3, '3. audit_logs columns', ac.col, ac.typ,
       case when ac.col ~* '(content|message|body|note|transcript|symptom)'
            then '✗ CONTENT COLUMN — violates invariant #6, remove it'
            else '✓' end
from audit_cols ac

order by seq, subject, detail;


-- ============================================================
-- Granting yourself a staff role for the clinician demo.
-- Sign up a clinician account through the app FIRST, then run this
-- with that account's email. Roles live in the JWT, not in a table.
-- ============================================================
--
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--                         || '{"role":"clinician"}'::jsonb
-- where email = 'clinician@example.com';
--
-- IMPORTANT: app_metadata is baked into the JWT at sign-in. The account
-- must SIGN OUT AND BACK IN before is_staff() returns true. If your
-- clinician view is empty and you are sure the role is set, this is why.
