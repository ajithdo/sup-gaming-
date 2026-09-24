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
