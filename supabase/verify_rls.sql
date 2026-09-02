-- ============================================================
-- Run this in the Supabase SQL Editor AFTER 0001_init.sql.
-- This is the evidence for CLAUDE.md safety invariant #7.
-- ============================================================

-- 1. Every table must show rls_enabled = true and policies > 0.
--    A table with rls_enabled = true and policies = 0 is locked shut:
--    it will return an empty array to the client with NO error.
select
  c.relname           as table_name,
  c.relrowsecurity    as rls_enabled,
  count(p.policyname) as policies
from pg_class c
left join pg_policies p
  on p.schemaname = 'public' and p.tablename = c.relname
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relname;

-- Expected: 7 rows, all rls_enabled = true, all policies >= 1.


-- 2. List the policies themselves, so you can eyeball who reads what.
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- 3. audit_logs must have no content-bearing column (invariant #6).
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'audit_logs'
order by ordinal_position;

-- Expected: id, actor_id, action, resource_type, resource_id, created_at.
-- If you ever see a `content` / `message` / `body` column here, remove it.


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
