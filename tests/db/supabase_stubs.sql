-- Minimal stand-in for the parts of a Supabase database our migrations rely on,
-- so the SQL can be tested against a plain Postgres server (no Docker needed).
-- NOT used in production — a real Supabase project already has all of this.

create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit bypassrls;

create schema if not exists extensions;
create schema if not exists auth;

grant usage on schema public, extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- auth.users (only the columns our triggers read)
create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Same logic as Supabase's auth.uid(): read the "sub" claim PostgREST sets per request.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase's default privileges: API roles get broad grants on everything created
-- in "public" (RLS and our explicit REVOKEs are what actually protect data).
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create publication supabase_realtime;

-- An account that already existed before our migrations ran (profile backfill test).
insert into auth.users (email) values ('legacy@example.com');
