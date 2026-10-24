-- =============================================================================
-- TEST-ONLY SHIM. NOT a migration. NEVER run this on a real Supabase project.
-- Recreates the small part of Supabase that our migrations rely on, so the SQL can be exercised
-- in plain PostgreSQL (PGlite) during `npm run test:db`:
--   * roles anon / authenticated / service_role (service_role bypasses RLS, as in Supabase)
--   * auth.users and auth.uid() / auth.role() reading the PostgREST-style JWT claim settings
-- It does NOT reproduce GoTrue, PostgREST, Storage, or Supabase's default privileges.
-- =============================================================================
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
-- Supabase grants new public objects to these roles by default; replicate that so our REVOKEs are what's tested.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
