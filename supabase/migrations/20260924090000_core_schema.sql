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
