-- ============================================================================
-- NextLevel Gaming Zone — ONE-TIME DATABASE SETUP
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- (It is the three files in supabase/migrations/ combined, in order.)
-- Run it once on a fresh project. Running it a second time will fail harmlessly
-- with "already exists" errors.
-- ============================================================================


-- >>>>>>>>>> supabase/migrations/20260924090000_core_schema.sql
-- =============================================================================
-- NextLevel Gaming Zone — core schema
--
-- Tables, types, constraints, Row Level Security (RLS) and role management.
-- Booking writes never go straight to the tables: they go through the
-- SECURITY DEFINER functions in the next migration, which run inside a single
-- transaction and re-check availability before committing.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('customer', 'admin');
create type public.room_state as enum ('book', 'soon', 'walkin');
create type public.pass_kind as enum ('open', 'private', 'racing');
create type public.booking_status as enum (
  'held',        -- created by a customer, waiting for WhatsApp confirmation
  'confirmed',   -- confirmed by an admin
  'checked_in',  -- customer arrived
  'completed',   -- session finished
  'cancelled',   -- cancelled by customer or admin
  'expired',     -- hold ran out before it was confirmed
  'no_show'      -- customer never arrived
);

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at fresh
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Venue settings (exactly one row)
-- -----------------------------------------------------------------------------
create table public.venue_settings (
  id                           boolean primary key default true check (id),
  timezone                     text     not null default 'Asia/Kolkata',
  open_hour                    smallint not null default 12 check (open_hour between 0 and 23),
  last_start_hour              smallint not null default 23 check (last_start_hour between 0 and 23),
  -- Sessions must end by this hour (24 = midnight), so a booking never spans two dates.
  close_hour                   smallint not null default 24 check (close_hour between 1 and 24),
  max_duration_hours           smallint not null default 4  check (max_duration_hours between 1 and 12),
  booking_window_days          smallint not null default 7  check (booking_window_days between 1 and 60),
  -- A slot stays bookable until this many minutes after it starts.
  late_grace_minutes           smallint not null default 15 check (late_grace_minutes between 0 and 59),
  -- How long a new booking is held before it expires unless an admin confirms it. 0 = never expires.
  hold_minutes                 smallint not null default 10 check (hold_minutes >= 0),
  max_active_bookings_per_user smallint not null default 4  check (max_active_bookings_per_user >= 1),
  food_options                 text[]   not null default array['Burgers', 'Pizzas', 'Pasta', 'Loaded Fries', 'Cold Coffee', 'Shakes & Mocktails'],
  whatsapp_number              text     not null default '919381487875',
  updated_at                   timestamptz not null default now(),
  check (last_start_hour >= open_hour),
  check (close_hour > last_start_hour)
);

insert into public.venue_settings default values;

create trigger venue_settings_updated_at
  before update on public.venue_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Rooms
-- -----------------------------------------------------------------------------
create table public.rooms (
  id          text primary key check (id ~ '^[a-z0-9_-]{2,32}$'),
  name        text not null,
  subtitle    text not null default '',
  state       public.room_state not null default 'book',
  -- rates[n] = price per hour for n players (Solo, Duo, Trio, Squad ...)
  rates       integer[] not null default '{}' check (0 < all (rates) and array_position(rates, null) is null),
  -- Which gaming pass can be redeemed in this room (null = none)
  pass_kind   public.pass_kind,
  sort_order  smallint not null default 0,
  updated_at  timestamptz not null default now(),
  check (state <> 'book' or cardinality(rates) >= 1)
);

create trigger rooms_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

insert into public.rooms (id, name, subtitle, state, rates, pass_kind, sort_order) values
  ('pr1',  'Private Room 1', 'PS5 · Your Own Private Room · 4K · Recliner', 'book',   '{199,299,399,499}', 'private', 1),
  ('pr2',  'Private Room 2', 'PS5 · Your Own Private Room · 4K · Recliner', 'book',   '{199,299,399,499}', 'private', 2),
  ('race', 'Racing Wheel',   'Logitech G29 · Force Feedback · Pedals',      'book',   '{199}',             'racing',  3),
  ('vr',   'VR Room',        'PlayStation VR2 · 50+ VR Titles',             'soon',   '{99}',              null,      4),
  ('open', 'Open Room',      'PS5 Slim × 2 · Shared Space',                 'walkin', '{99}',              'open',    5)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Profiles + roles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text check (char_length(full_name) <= 80),
  phone       text check (phone ~ '^\d{10}$'),
  role        public.app_role not null default 'customer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index profiles_admins_idx on public.profiles (id) where role = 'admin';

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Is the current request made by an admin? Used by RLS policies and RPCs.
-- SECURITY DEFINER so it can read profiles without tripping profiles' own RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Create a profile for every new auth user. The role is ALWAYS 'customer' here:
-- never trust role information from user-supplied sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g');
  v_name  text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
begin
  if char_length(v_phone) = 12 and left(v_phone, 2) = '91' then
    v_phone := right(v_phone, 10);
  end if;

  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    lower(new.email),
    left(v_name, 80),
    case when v_phone ~ '^\d{10}$' then v_phone end,
    'customer'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that existed before this migration get a (customer) profile too.
insert into public.profiles (id, email, role)
select u.id, lower(u.email), 'customer'
from auth.users u
on conflict (id) do nothing;

-- Keep profiles.email in sync when a user changes their email.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Defence in depth: API roles can never change a role directly, even if column
-- privileges are loosened by mistake later. Admins change roles through the
-- admin_set_user_role() RPC (which runs as the function owner).
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and current_user in ('anon', 'authenticated') then
    raise exception 'Only an admin can change roles.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'Profile id cannot change.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- -----------------------------------------------------------------------------
-- Coupons (promo codes are validated server-side only)
-- -----------------------------------------------------------------------------
create table public.coupons (
  code         text primary key check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,32}$'),
  description  text,
  percent_off  smallint not null check (percent_off between 1 and 100),
  active       boolean not null default true,
  valid_from   timestamptz,
  valid_until  timestamptz,
  max_uses     integer check (max_uses > 0),
  uses         integer not null default 0 check (uses >= 0),
  created_at   timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

insert into public.coupons (code, description, percent_off)
values ('WARP15', '15% off gaming (not combinable with passes)', 15)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Gaming passes (prepaid hours)
-- -----------------------------------------------------------------------------
create table public.passes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code = upper(code) and code ~ '^[A-Z0-9-]{3,32}$'),
  kind          public.pass_kind not null,
  holder_name   text not null check (char_length(holder_name) between 1 and 80),
  holder_phone  text not null check (holder_phone ~ '^\d{10}$'),
  hours_total   numeric(6, 2) not null check (hours_total > 0),
  hours_used    numeric(6, 2) not null default 0 check (hours_used >= 0),
  valid_from    date not null default current_date,
  valid_until   date not null,
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  check (valid_until >= valid_from)
);

-- -----------------------------------------------------------------------------
-- Bookings
-- -----------------------------------------------------------------------------
create table public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  user_id             uuid not null references auth.users (id) on delete cascade,
  room_id             text not null references public.rooms (id),
  booking_date        date not null,
  start_hour          smallint not null check (start_hour between 0 and 23),
  duration_hours      smallint not null check (duration_hours between 1 and 12),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  slot                tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  players             smallint not null check (players between 1 and 8),
  customer_name       text not null check (char_length(customer_name) between 1 and 80),
  customer_phone      text not null check (customer_phone ~ '^\d{10}$'),
  customer_email      text not null check (char_length(customer_email) <= 254),
  game_request        text check (char_length(game_request) <= 200),
  foods               text[] not null default '{}',
  pass_id             uuid references public.passes (id) on delete set null,
  pass_code           text,                                 -- snapshot, shown to the customer
  pass_hours_charged  boolean not null default false,
  coupon_code         text references public.coupons (code) on update cascade on delete set null,
  hourly_rate         integer not null check (hourly_rate >= 0),
  gaming_amount       integer not null check (gaming_amount >= 0),
  discount_amount     integer not null default 0 check (discount_amount >= 0),
  total_amount        integer not null check (total_amount >= 0),
  status              public.booking_status not null default 'held',
  hold_expires_at     timestamptz,
  admin_note          text check (char_length(admin_note) <= 500),
  status_changed_at   timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint bookings_time_order check (ends_at > starts_at),
  -- Final safety net against double booking: two *active* bookings for the same
  -- room can never overlap, no matter how many transactions race each other.
  constraint bookings_no_overlap exclude using gist (room_id with =, slot with &&)
    where (status in ('held', 'confirmed', 'checked_in'))
);

create index bookings_user_idx      on public.bookings (user_id, starts_at desc);
create index bookings_date_room_idx on public.bookings (booking_date, room_id);
create index bookings_held_idx      on public.bookings (hold_expires_at) where status = 'held';
create index bookings_pass_idx      on public.bookings (pass_id) where pass_id is not null;

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.venue_settings enable row level security;
alter table public.rooms          enable row level security;
alter table public.profiles       enable row level security;
alter table public.coupons        enable row level security;
alter table public.passes         enable row level security;
alter table public.bookings       enable row level security;

-- venue_settings: public read, admin write
create policy "venue settings are public"
  on public.venue_settings for select to anon, authenticated using (true);
create policy "admins update venue settings"
  on public.venue_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- rooms: public read, admin write
create policy "rooms are public"
  on public.rooms for select to anon, authenticated using (true);
create policy "admins update rooms"
  on public.rooms for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- profiles: you see your own row; admins see everyone
create policy "read own profile or admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "update own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- coupons & passes: admins only (customers use validate_coupon / create_booking)
create policy "admins manage coupons"
  on public.coupons for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins manage passes"
  on public.passes for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- bookings: read your own; admins read all. No write policies on purpose:
-- every write goes through the transactional RPCs.
create policy "read own bookings or admin"
  on public.bookings for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Table privileges (Supabase grants broad defaults; tighten them explicitly)
-- -----------------------------------------------------------------------------
revoke all on public.venue_settings, public.rooms from anon, authenticated;
grant select on public.venue_settings, public.rooms to anon, authenticated;
grant update on public.venue_settings, public.rooms to authenticated;           -- RLS: admins only

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;           -- never "role"

revoke all on public.coupons, public.passes from anon, authenticated;
grant select, insert, update, delete on public.coupons, public.passes to authenticated;  -- RLS: admins only

revoke all on public.bookings from anon, authenticated;
grant select on public.bookings to authenticated;

-- Helper/trigger functions are not part of the public API.
revoke execute on function public.set_updated_at()            from public, anon, authenticated;
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.handle_user_email_change()  from public, anon, authenticated;
revoke execute on function public.guard_profile_role()        from public, anon, authenticated;
grant  execute on function public.is_admin()                  to anon, authenticated;

-- >>>>>>>>>> supabase/migrations/20260924090100_booking_functions.sql
-- =============================================================================
-- NextLevel Gaming Zone — booking API (Postgres functions exposed as RPCs)
--
-- Every function below runs inside ONE database transaction (PostgREST wraps each
-- RPC call in a transaction). If any step raises, everything the function did is
-- rolled back — no half-written bookings, no coupon use without a booking.
--
-- Errors are raised with a human-readable message plus a machine-readable HINT
-- (e.g. SLOT_TAKEN) that the frontend uses to decide what to do next.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------

-- Does this booking currently block its slot? (held-but-expired holds don't.)
create or replace function public.booking_blocks_slot(p_status public.booking_status, p_hold_expires_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('held', 'confirmed', 'checked_in')
     and not (p_status = 'held' and p_hold_expires_at is not null and p_hold_expires_at <= now());
$$;

-- Short, unambiguous booking code body (no 0/O/1/I).
create or replace function public.random_code(p_len integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, p_len);
$$;

-- Why a coupon can't be used right now (null = it can).
create or replace function public.coupon_problem(c public.coupons)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when c.code is null                                         then 'Invalid or expired code'
    when not c.active                                           then 'Invalid or expired code'
    when c.valid_from  is not null and now() <  c.valid_from    then 'This code isn''t active yet'
    when c.valid_until is not null and now() >= c.valid_until   then 'Invalid or expired code'
    when c.max_uses    is not null and c.uses >= c.max_uses     then 'This code has been fully redeemed'
  end;
$$;

-- Serialize every writer that touches one room on one date. Transaction-scoped:
-- released automatically on COMMIT/ROLLBACK. Key = (room hash, days since 2000).
create or replace function public.lock_room_date(p_room_id text, p_date date)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtext('nl:room:' || p_room_id), (p_date - date '2000-01-01'));
$$;

-- -----------------------------------------------------------------------------
-- Public reads
-- -----------------------------------------------------------------------------

-- Which hours are taken? Returns no personal data, so anyone may call it.
create or replace function public.get_booked_slots(p_from date default null, p_to date default null)
returns table (room_id text, booking_date date, start_hour smallint, duration_hours smallint)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (now() at time zone s.timezone)::date as d from public.venue_settings s where s.id
  ), bounds as (
    select coalesce(p_from, today.d) as d_from,
           least(coalesce(p_to, coalesce(p_from, today.d) + 6), coalesce(p_from, today.d) + 31) as d_to
    from today
  )
  select b.room_id, b.booking_date, b.start_hour, b.duration_hours
  from public.bookings b
  cross join bounds
  where b.booking_date between bounds.d_from and bounds.d_to
    and public.booking_blocks_slot(b.status, b.hold_expires_at)
  order by b.booking_date, b.room_id, b.start_hour;
$$;

-- Check a promo code without revealing the coupon table.
create or replace function public.validate_coupon(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.coupons;
  v_problem text;
begin
  select * into c from public.coupons where code = upper(btrim(coalesce(p_code, '')));
  v_problem := public.coupon_problem(c);
  if v_problem is not null then
    return jsonb_build_object('valid', false, 'message', v_problem);
  end if;
  return jsonb_build_object(
    'valid', true,
    'code', c.code,
    'percent_off', c.percent_off,
    'message', c.percent_off || '% OFF APPLIED'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- create_booking — the transactional booking function
--
-- Race-condition strategy (defence in depth):
--   1. Advisory locks: one per user, then one per (room, date). Concurrent
--      requests for the same room+date queue up here and run one at a time.
--      Locks are always taken in the same order, so they can't deadlock.
--   2. Re-check: once we hold the lock we look for overlapping active bookings.
--      The function is VOLATILE, so under READ COMMITTED this SELECT takes a fresh
--      snapshot and sees any booking the previous lock holder just committed.
--   3. Exclusion constraint (bookings_no_overlap): even if someone bypasses this
--      function, or runs at a stricter isolation level, Postgres itself refuses
--      overlapping active bookings. We turn that error into SLOT_TAKEN as well.
--   Price, coupon and pass checks all happen server-side; the client total is
--   never trusted.
-- -----------------------------------------------------------------------------
create or replace function public.create_booking(
  p_room_id         text,
  p_date            date,
  p_start_hour      integer,
  p_duration_hours  integer,
  p_players         integer,
  p_name            text,
  p_phone           text,
  p_email           text,
  p_game_request    text    default null,
  p_foods           text[]  default '{}',
  p_coupon_code     text    default null,
  p_pass_code       text    default null,
  p_pass_last4      text    default null
)
returns public.bookings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := auth.uid();
  s               public.venue_settings;
  r               public.rooms;
  v_today         date;
  v_starts        timestamptz;
  v_ends          timestamptz;
  v_slot          tstzrange;
  v_name          text;
  v_phone         text;
  v_email         text;
  v_game          text;
  v_foods         text[];
  v_rate          integer;
  v_gaming        integer;
  v_discount      integer := 0;
  v_total         integer;
  v_coupon        public.coupons;
  v_coupon_code   text;
  v_pass          public.passes;
  v_reserved      numeric;
  v_active        integer;
  v_code          text;
  v_constraint    text;
  v_booking       public.bookings;
begin
  if v_uid is null then
    raise exception 'Please sign in to book a slot.' using errcode = '28000', hint = 'AUTH_REQUIRED';
  end if;

  select * into s from public.venue_settings where id;
  v_today := (now() at time zone s.timezone)::date;

  -- 1. Validate the request ----------------------------------------------------
  select * into r from public.rooms where id = p_room_id;
  if not found or r.state <> 'book' then
    raise exception 'That room can''t be booked online.' using errcode = 'P0001', hint = 'ROOM_NOT_BOOKABLE';
  end if;

  if p_players is null or p_players < 1 or p_players > cardinality(r.rates) then
    raise exception 'Pick between 1 and % players for this room.', cardinality(r.rates)
      using errcode = 'P0001', hint = 'INVALID_PLAYERS';
  end if;

  if p_duration_hours is null or p_duration_hours < 1 or p_duration_hours > s.max_duration_hours then
    raise exception 'Sessions are 1 to % hours long.', s.max_duration_hours
      using errcode = 'P0001', hint = 'INVALID_DURATION';
  end if;

  if p_date is null or p_date < v_today or p_date >= v_today + s.booking_window_days then
    raise exception 'You can book up to % days ahead.', s.booking_window_days
      using errcode = 'P0001', hint = 'INVALID_DATE';
  end if;

  if p_start_hour is null
     or p_start_hour < s.open_hour
     or p_start_hour > s.last_start_hour
     or p_start_hour + p_duration_hours > s.close_hour then
    raise exception 'That start time and duration don''t fit our opening hours.'
      using errcode = 'P0001', hint = 'INVALID_TIME';
  end if;

  v_starts := (p_date::timestamp + make_interval(hours => p_start_hour)) at time zone s.timezone;
  v_ends   := v_starts + make_interval(hours => p_duration_hours);
  v_slot   := tstzrange(v_starts, v_ends, '[)');

  if v_starts + make_interval(mins => s.late_grace_minutes) <= now() then
    raise exception 'That time has already passed — pick a later slot.'
      using errcode = 'P0001', hint = 'SLOT_PASSED';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'Enter your name.' using errcode = 'P0001', hint = 'INVALID_NAME';
  end if;

  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if char_length(v_phone) = 12 and left(v_phone, 2) = '91' then
    v_phone := right(v_phone, 10);
  end if;
  if v_phone !~ '^\d{10}$' then
    raise exception 'Enter a valid 10-digit phone number.' using errcode = 'P0001', hint = 'INVALID_PHONE';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid email.' using errcode = 'P0001', hint = 'INVALID_EMAIL';
  end if;

  v_game := nullif(btrim(coalesce(p_game_request, '')), '');
  if char_length(v_game) > 200 then
    raise exception 'Keep the game request under 200 characters.' using errcode = 'P0001', hint = 'INVALID_GAME_REQUEST';
  end if;

  v_foods := array(select distinct f from unnest(coalesce(p_foods, '{}')) as f order by f);
  if not (v_foods <@ s.food_options) then
    raise exception 'Unknown food option.' using errcode = 'P0001', hint = 'INVALID_FOOD';
  end if;

  -- 2. Serialize competing writers -------------------------------------------
  perform pg_advisory_xact_lock(hashtext('nl:user'), hashtext(v_uid::text));
  perform public.lock_room_date(r.id, p_date);

  -- 3. Holds that ran out no longer block anyone: mark overlapping ones expired.
  update public.bookings b
     set status = 'expired', status_changed_at = now()
   where b.room_id = r.id
     and b.status = 'held'
     and b.hold_expires_at is not null
     and b.hold_expires_at <= now()
     and b.slot && v_slot;

  -- 4. Is the slot STILL free? (checked while holding the lock) --------------
  if exists (
    select 1 from public.bookings b
     where b.room_id = r.id
       and b.status in ('held', 'confirmed', 'checked_in')
       and b.slot && v_slot
  ) then
    raise exception 'Sorry — that slot was just taken. Please pick another time.'
      using errcode = 'P0001', hint = 'SLOT_TAKEN';
  end if;

  -- 5. Fair-use limit per customer --------------------------------------------
  select count(*) into v_active
    from public.bookings b
   where b.user_id = v_uid
     and b.ends_at > now()
     and public.booking_blocks_slot(b.status, b.hold_expires_at);
  if v_active >= s.max_active_bookings_per_user then
    raise exception 'You already have % upcoming bookings. Cancel one or contact us to book more.', v_active
      using errcode = 'P0001', hint = 'TOO_MANY_BOOKINGS';
  end if;

  -- 6. Price (server is the source of truth) ----------------------------------
  v_rate   := r.rates[p_players];
  v_gaming := v_rate * p_duration_hours;

  if nullif(btrim(coalesce(p_pass_code, '')), '') is not null then
    -- Gaming pass: lock the pass row so two bookings can't spend the same hours.
    select * into v_pass from public.passes where code = upper(btrim(p_pass_code)) for update;
    if not found
       or not v_pass.active
       or right(v_pass.holder_phone, 4) is distinct from btrim(coalesce(p_pass_last4, '')) then
      raise exception 'We couldn''t verify that pass. Check the pass ID and the last 4 digits of its phone number.'
        using errcode = 'P0001', hint = 'PASS_INVALID';
    end if;
    if p_date < v_pass.valid_from or p_date > v_pass.valid_until then
      raise exception 'That pass isn''t valid on the selected date.' using errcode = 'P0001', hint = 'PASS_EXPIRED';
    end if;
    if r.pass_kind is null or v_pass.kind <> r.pass_kind then
      raise exception 'That pass can''t be used for %.', r.name using errcode = 'P0001', hint = 'PASS_WRONG_ROOM';
    end if;

    select coalesce(sum(b.duration_hours), 0) into v_reserved
      from public.bookings b
     where b.pass_id = v_pass.id
       and not b.pass_hours_charged
       and public.booking_blocks_slot(b.status, b.hold_expires_at);

    if v_pass.hours_total - v_pass.hours_used - v_reserved < p_duration_hours then
      raise exception 'Not enough hours left on that pass (% h available).',
        greatest(v_pass.hours_total - v_pass.hours_used - v_reserved, 0)
        using errcode = 'P0001', hint = 'PASS_HOURS';
    end if;
    v_total := 0;  -- gaming is paid by the pass; promo codes don't apply
  else
    if nullif(btrim(coalesce(p_coupon_code, '')), '') is not null then
      -- Lock the coupon row so max_uses can't be exceeded by concurrent bookings.
      select * into v_coupon from public.coupons where code = upper(btrim(p_coupon_code)) for update;
      if public.coupon_problem(v_coupon) is not null then
        raise exception '%', public.coupon_problem(v_coupon) using errcode = 'P0001', hint = 'COUPON_INVALID';
      end if;
      v_discount    := round(v_gaming * v_coupon.percent_off / 100.0);
      v_coupon_code := v_coupon.code;
      update public.coupons set uses = uses + 1 where code = v_coupon.code;
    end if;
    v_total := v_gaming - v_discount;
  end if;

  -- 7. Insert. The exclusion constraint is the final guard ---------------------
  for attempt in 1..10 loop
    v_code := 'NL-' || public.random_code(case when attempt <= 5 then 4 else 6 end);
    begin
      insert into public.bookings (
        code, user_id, room_id, booking_date, start_hour, duration_hours, starts_at, ends_at,
        players, customer_name, customer_phone, customer_email, game_request, foods,
        pass_id, pass_code, coupon_code, hourly_rate, gaming_amount, discount_amount, total_amount,
        status, hold_expires_at
      ) values (
        v_code, v_uid, r.id, p_date, p_start_hour, p_duration_hours, v_starts, v_ends,
        p_players, v_name, v_phone, v_email, v_game, v_foods,
        v_pass.id, v_pass.code, v_coupon_code, v_rate, v_gaming, v_discount, v_total,
        'held', case when s.hold_minutes > 0 then now() + make_interval(mins => s.hold_minutes) end
      )
      returning * into v_booking;

      -- Remember contact details for next time (only fills blanks).
      update public.profiles
         set full_name = coalesce(full_name, left(v_name, 80)),
             phone     = coalesce(phone, v_phone)
       where id = v_uid and (full_name is null or phone is null);

      return v_booking;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'bookings_code_key' then
          raise;
        end if;
        -- booking code collision: loop and try a new code
      when exclusion_violation or serialization_failure then
        raise exception 'Sorry — that slot was just taken. Please pick another time.'
          using errcode = 'P0001', hint = 'SLOT_TAKEN';
    end;
  end loop;

  raise exception 'Could not create a booking code. Please try again.' using errcode = 'P0001', hint = 'RETRY';
end;
$$;

-- -----------------------------------------------------------------------------
-- cancel_my_booking — customers cancel their own upcoming booking
-- -----------------------------------------------------------------------------
create or replace function public.cancel_my_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = '28000', hint = 'AUTH_REQUIRED';
  end if;

  select * into b from public.bookings
   where id = p_booking_id and user_id = auth.uid()
   for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;
  if b.status not in ('held', 'confirmed') then
    raise exception 'This booking can''t be cancelled any more.' using errcode = 'P0001', hint = 'NOT_CANCELLABLE';
  end if;
  if b.starts_at <= now() then
    raise exception 'This session has already started — please talk to the front desk.' using errcode = 'P0001', hint = 'NOT_CANCELLABLE';
  end if;

  update public.bookings
     set status = 'cancelled', status_changed_at = now(), hold_expires_at = null
   where id = b.id
  returning * into b;
  return b;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: change a booking's status (confirm, check in, complete, cancel ...)
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_booking_status(
  p_booking_id uuid,
  p_status     public.booking_status,
  p_note       text default null
)
returns public.bookings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b          public.bookings;
  v_allowed  public.booking_status[];
  v_blocking constant public.booking_status[] := array['held', 'confirmed', 'checked_in']::public.booking_status[];
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = '42501', hint = 'FORBIDDEN';
  end if;

  select * into b from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;

  -- Same lock order as create_booking (room/date lock, then the row).
  perform public.lock_room_date(b.room_id, b.booking_date);
  select * into b from public.bookings where id = p_booking_id for update;

  v_allowed := case b.status
    when 'held'       then array['confirmed', 'cancelled', 'expired']
    when 'confirmed'  then array['checked_in', 'completed', 'cancelled', 'no_show']
    when 'checked_in' then array['completed']
    when 'expired'    then array['confirmed', 'cancelled']
    when 'cancelled'  then array['confirmed']
    when 'no_show'    then array['confirmed']
    else array[]::text[]
  end::public.booking_status[];

  if p_status is null or not (p_status = any (v_allowed)) then
    raise exception 'Can''t change a % booking to %.', b.status, coalesce(p_status::text, 'nothing')
      using errcode = 'P0001', hint = 'INVALID_TRANSITION';
  end if;

  -- Re-activating a booking: its slot must still be free (checked under the lock).
  if p_status = any (v_blocking) and not (b.status = any (v_blocking)) then
    update public.bookings x
       set status = 'expired', status_changed_at = now()
     where x.room_id = b.room_id and x.status = 'held'
       and x.hold_expires_at is not null and x.hold_expires_at <= now()
       and x.slot && b.slot and x.id <> b.id;
    if exists (
      select 1 from public.bookings x
       where x.room_id = b.room_id and x.id <> b.id
         and x.status = any (v_blocking)
         and x.slot && b.slot
    ) then
      raise exception 'Another booking now holds that slot.' using errcode = 'P0001', hint = 'SLOT_TAKEN';
    end if;
  end if;

  -- Spend pass hours when the customer actually plays.
  if b.pass_id is not null and not b.pass_hours_charged and p_status in ('checked_in', 'completed') then
    update public.passes set hours_used = hours_used + b.duration_hours where id = b.pass_id;
    b.pass_hours_charged := true;
  end if;

  begin
    update public.bookings
       set status             = p_status,
           status_changed_at  = now(),
           hold_expires_at    = case when p_status = 'held' then hold_expires_at end,
           pass_hours_charged = b.pass_hours_charged,
           admin_note         = coalesce(nullif(btrim(p_note), ''), admin_note)
     where id = b.id
    returning * into b;
  exception when exclusion_violation then
    raise exception 'Another booking now holds that slot.' using errcode = 'P0001', hint = 'SLOT_TAKEN';
  end;

  return b;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: grant or revoke the admin role
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.app_role)
returns public.profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.profiles;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = '42501', hint = 'FORBIDDEN';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t change your own role — ask another admin.' using errcode = 'P0001', hint = 'SELF_ROLE_CHANGE';
  end if;
  if p_role is null then
    raise exception 'Pick a role.' using errcode = 'P0001', hint = 'INVALID_ROLE';
  end if;

  update public.profiles set role = p_role where id = p_user_id returning * into p;
  if not found then
    raise exception 'User not found.' using errcode = 'P0001', hint = 'NOT_FOUND';
  end if;
  return p;
end;
$$;

-- -----------------------------------------------------------------------------
-- Housekeeping: mark holds that ran out as expired (run by pg_cron if enabled)
-- -----------------------------------------------------------------------------
create or replace function public.expire_stale_holds()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with expired as (
    update public.bookings
       set status = 'expired', status_changed_at = now()
     where status = 'held'
       and hold_expires_at is not null
       and hold_expires_at <= now()
    returning 1
  )
  select count(*)::integer from expired;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges. Supabase grants EXECUTE on new functions to anon and
-- authenticated by default, so lock each one down explicitly.
-- -----------------------------------------------------------------------------
revoke execute on function public.booking_blocks_slot(public.booking_status, timestamptz) from public, anon, authenticated;
revoke execute on function public.random_code(integer)                         from public, anon, authenticated;
revoke execute on function public.coupon_problem(public.coupons)               from public, anon, authenticated;
revoke execute on function public.lock_room_date(text, date)                   from public, anon, authenticated;
revoke execute on function public.expire_stale_holds()                         from public, anon, authenticated;

revoke execute on function public.get_booked_slots(date, date)                 from public;
grant  execute on function public.get_booked_slots(date, date)                 to anon, authenticated;

revoke execute on function public.validate_coupon(text)                        from public;
grant  execute on function public.validate_coupon(text)                        to anon, authenticated;

revoke execute on function public.create_booking(text, date, integer, integer, integer, text, text, text, text, text[], text, text, text) from public, anon;
grant  execute on function public.create_booking(text, date, integer, integer, integer, text, text, text, text, text[], text, text, text) to authenticated;

revoke execute on function public.cancel_my_booking(uuid)                      from public, anon;
grant  execute on function public.cancel_my_booking(uuid)                      to authenticated;

revoke execute on function public.admin_set_booking_status(uuid, public.booking_status, text) from public, anon;
grant  execute on function public.admin_set_booking_status(uuid, public.booking_status, text) to authenticated;

revoke execute on function public.admin_set_user_role(uuid, public.app_role)   from public, anon;
grant  execute on function public.admin_set_user_role(uuid, public.app_role)   to authenticated;

-- >>>>>>>>>> supabase/migrations/20260924090200_realtime_and_cron.sql
-- =============================================================================
-- NextLevel Gaming Zone — realtime + scheduled housekeeping
-- =============================================================================

-- Let the admin dashboard receive live booking changes. Realtime still applies
-- RLS, so customers only ever receive events for their own bookings.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
     ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end;
$$;

-- Every minute, mark holds that ran out as 'expired' so dashboards show the
-- right status. (Availability checks already ignore stale holds, so the site
-- stays correct even if pg_cron isn't enabled on your project.)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    execute $cron$ select cron.schedule('nextlevel-expire-holds', '* * * * *', 'select public.expire_stale_holds()') $cron$;
  else
    raise notice 'pg_cron is not available; skipping the expire-holds job.';
  end if;
exception when others then
  raise notice 'Could not schedule the expire-holds job (%). Enable pg_cron in the dashboard and re-run this block.', sqlerrm;
end;
$$;
