// Database tests for the NextLevel booking backend.
//
// Runs the real Supabase migrations against a plain Postgres server (with a tiny
// stub of Supabase's auth schema), then exercises RLS, role management and the
// transactional booking function — including many truly concurrent bookings.
//
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npm run test:db
//
// The URL must point at a server where the user can CREATE/DROP DATABASE.
// A throwaway database named "nl_test" is created (and dropped) each run.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:54329/postgres';
const DB_NAME = 'nl_test';
const DB_URL = (() => { const u = new URL(ADMIN_URL); u.pathname = '/' + DB_NAME; return u.toString(); })();

let pool;          // pool used for per-user transactions
let su;            // superuser connection for setup / inspection
const users = {};  // name -> uuid
let TOMORROW;      // 'YYYY-MM-DD' in venue time
let DAY2;          // the day after tomorrow

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function resetDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();

  su = new pg.Client({ connectionString: DB_URL });
  await su.connect();
  await su.query('set client_min_messages = warning');
  const files = [
    path.join(root, 'tests/db/supabase_stubs.sql'),
    ...readdirSync(path.join(root, 'supabase/migrations')).sort().map(f => path.join(root, 'supabase/migrations', f)),
    path.join(root, 'supabase/seed.sql'),
  ];
  for (const f of files) {
    // roles are cluster-wide: tolerate "already exists" when re-running
    const sql = readFileSync(f, 'utf8').replace(/^create role (\w+)(.*);$/gm,
      (_, r, rest) => `do $$ begin create role ${r}${rest}; exception when duplicate_object then null; end $$;`);
    await su.query(sql);
  }
  pool = new pg.Pool({ connectionString: DB_URL, max: 80 });
}

async function createUser(name, meta = {}) {
  const { rows } = await su.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${name}@example.com`, JSON.stringify(meta)]);
  users[name] = rows[0].id;
  return rows[0].id;
}

/** Run fn(client) inside a transaction as a Supabase API role (like PostgREST does). */
async function as(userId, fn, { client: given } = {}) {
  const client = given || await pool.connect();
  try {
    await client.query('begin');
    if (userId) {
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    } else {
      await client.query('set local role anon');
    }
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    if (!given) client.release();
  }
}

const BOOK_SQL = `select * from public.create_booking(
  p_room_id => $1, p_date => $2, p_start_hour => $3, p_duration_hours => $4, p_players => $5,
  p_name => $6, p_phone => $7, p_email => $8, p_game_request => $9, p_foods => $10,
  p_coupon_code => $11, p_pass_code => $12, p_pass_last4 => $13)`;

function book(userId, o = {}) {
  const b = { room: 'pr1', date: TOMORROW, start: 15, dur: 1, players: 1, name: 'Test Gamer',
    phone: '+91 98765 43210', email: 'gamer@example.com', game: null, foods: [], coupon: null,
    pass: null, last4: null, ...o };
  return as(userId, async c => (await c.query(BOOK_SQL, [b.room, b.date, b.start, b.dur, b.players,
    b.name, b.phone, b.email, b.game, b.foods, b.coupon, b.pass, b.last4])).rows[0]);
}

/** Assert that a promise rejects with a given Postgres HINT (our error codes). */
async function rejectsWithHint(promise, hint) {
  await assert.rejects(promise, e => {
    assert.equal(e.hint, hint, `expected hint ${hint}, got ${e.hint} (${e.message})`);
    return true;
  });
}

async function activeOverlaps() {
  const { rows } = await su.query(`
    select count(*)::int as n from public.bookings a
    join public.bookings b on a.room_id = b.room_id and a.id < b.id and a.slot && b.slot
    where a.status in ('held','confirmed','checked_in') and b.status in ('held','confirmed','checked_in')`);
  return rows[0].n;
}

async function clearBookings() {
  await su.query(`delete from public.bookings; update public.coupons set uses = 0; update public.passes set hours_used = 0`);
}

// ---------------------------------------------------------------------------
before(async () => {
  await resetDatabase();
  TOMORROW = (await su.query(`select to_char((now() at time zone 'Asia/Kolkata')::date + 1, 'YYYY-MM-DD') d`)).rows[0].d;
  DAY2 = (await su.query(`select to_char((now() at time zone 'Asia/Kolkata')::date + 2, 'YYYY-MM-DD') d`)).rows[0].d;
  await createUser('alice', { full_name: 'Alice', phone: '+91 90000 00001' });
  await createUser('bob');
  // someone trying to sneak a role in through sign-up metadata:
  await createUser('mallory', { role: 'admin', full_name: 'Mallory' });
  await createUser('owner');
  await su.query(`update public.profiles set role = 'admin' where id = $1`, [users.owner]);
  for (let i = 0; i < 60; i++) await createUser('racer' + i);
});

after(async () => {
  await pool?.end();
  await su?.end();
});

// ---------------------------------------------------------------------------
describe('auth, profiles and roles', () => {
  test('new users get a customer profile — sign-up metadata cannot grant admin', async () => {
    const { rows } = await su.query(`select id, role, full_name, phone from public.profiles where id = any($1)`,
      [[users.alice, users.mallory]]);
    const alice = rows.find(r => r.id === users.alice);
    const mallory = rows.find(r => r.id === users.mallory);
    assert.equal(alice.role, 'customer');
    assert.equal(alice.phone, '9000000001', 'phone is normalized to 10 digits');
    assert.equal(mallory.role, 'customer', 'role in metadata is ignored');
  });

  test('accounts that existed before the migration were backfilled as customers', async () => {
    const { rows } = await su.query(`select p.role from public.profiles p join auth.users u on u.id = p.id where u.email = 'legacy@example.com'`);
    assert.equal(rows[0]?.role, 'customer');
  });

  test('a customer cannot promote themselves', async () => {
    await assert.rejects(
      as(users.mallory, c => c.query(`update public.profiles set role = 'admin' where id = $1`, [users.mallory])),
      /permission denied/);
    // …but can edit their own name
    await as(users.mallory, c => c.query(`update public.profiles set full_name = 'M' where id = $1`, [users.mallory]));
  });

  test('is_admin() reflects the caller', async () => {
    assert.equal((await as(users.owner, c => c.query('select public.is_admin() a'))).rows[0].a, true);
    assert.equal((await as(users.alice, c => c.query('select public.is_admin() a'))).rows[0].a, false);
    assert.equal((await as(null, c => c.query('select public.is_admin() a'))).rows[0].a, false);
  });

  test('customers see only their own profile; admins see all', async () => {
    const mine = await as(users.alice, c => c.query('select id from public.profiles'));
    assert.deepEqual(mine.rows.map(r => r.id), [users.alice]);
    const all = await as(users.owner, c => c.query('select id from public.profiles'));
    assert.ok(all.rowCount >= 60);
    await assert.rejects(as(null, c => c.query('select id from public.profiles')), /permission denied/);
  });

  test('admin_set_user_role: admins only, and never on yourself', async () => {
    await rejectsWithHint(as(users.alice, c => c.query(`select public.admin_set_user_role($1, 'admin')`, [users.bob])), 'FORBIDDEN');
    await rejectsWithHint(as(users.owner, c => c.query(`select public.admin_set_user_role($1, 'customer')`, [users.owner])), 'SELF_ROLE_CHANGE');
    const r = await as(users.owner, c => c.query(`select role from public.admin_set_user_role($1, 'admin')`, [users.bob]));
    assert.equal(r.rows[0].role, 'admin');
    await as(users.owner, c => c.query(`select public.admin_set_user_role($1, 'customer')`, [users.bob]));
  });

  test('customers cannot read coupons or passes tables', async () => {
    assert.equal((await as(users.alice, c => c.query('select * from public.coupons'))).rowCount, 0);
    assert.equal((await as(users.alice, c => c.query('select * from public.passes'))).rowCount, 0);
    assert.ok((await as(users.owner, c => c.query('select * from public.coupons'))).rowCount >= 1);
  });
});

// ---------------------------------------------------------------------------
describe('create_booking — happy path and validation', () => {
  before(clearBookings);

  test('anonymous visitors cannot book', async () => {
    await assert.rejects(as(null, c => c.query(BOOK_SQL, ['pr1', TOMORROW, 15, 1, 1, 'x', '9876543210', 'a@b.co', null, [], null, null, null])),
      /permission denied/);
  });

  test('books a slot with a server-computed price and a 10-minute hold', async () => {
    const b = await book(users.alice, { players: 2, dur: 2, start: 14, foods: ['Pizzas', 'Burgers'], game: 'FC 26' });
    assert.match(b.code, /^NL-[A-Z2-9]{4}$/);
    assert.equal(b.status, 'held');
    assert.equal(b.hourly_rate, 299);
    assert.equal(b.gaming_amount, 598);
    assert.equal(b.total_amount, 598);
    assert.equal(b.customer_phone, '9876543210');
    assert.deepEqual(b.foods, ['Burgers', 'Pizzas']);
    const holdMin = (new Date(b.hold_expires_at) - Date.now()) / 60000;
    assert.ok(holdMin > 9 && holdMin <= 10.1, `hold ≈ 10 min, got ${holdMin}`);
  });

  test('an overlapping booking is rejected with SLOT_TAKEN', async () => {
    await rejectsWithHint(book(users.bob, { start: 15, dur: 1 }), 'SLOT_TAKEN');   // inside 14–16
    await rejectsWithHint(book(users.bob, { start: 13, dur: 2 }), 'SLOT_TAKEN');   // 13–15 overlaps
  });

  test('back-to-back bookings are fine, and other rooms are independent', async () => {
    await book(users.bob, { start: 16, dur: 1 });          // starts exactly when 14–16 ends
    await book(users.bob, { start: 13, dur: 1 });          // ends exactly when 14–16 starts
    await book(users.bob, { room: 'pr2', start: 14, dur: 2 });
  });

  test('clients cannot write bookings directly', async () => {
    await assert.rejects(as(users.alice, c => c.query(`update public.bookings set total_amount = 0`)), /permission denied/);
    await assert.rejects(as(users.alice, c => c.query(`delete from public.bookings`)), /permission denied/);
    await assert.rejects(as(users.alice, c => c.query(
      `insert into public.bookings (code, user_id, room_id, booking_date, start_hour, duration_hours, starts_at, ends_at, players,
        customer_name, customer_phone, customer_email, hourly_rate, gaming_amount, total_amount)
       values ('NL-HACK', $1, 'pr1', $2, 20, 1, now(), now() + interval '1h', 1, 'x', '9999999999', 'x@y.z', 0, 0, 0)`,
      [users.alice, TOMORROW])), /permission denied/);
  });

  test('RLS: customers only see their own bookings; admins see all; anon sees none', async () => {
    const a = await as(users.alice, c => c.query('select user_id from public.bookings'));
    assert.ok(a.rowCount >= 1 && a.rows.every(r => r.user_id === users.alice));
    const b = await as(users.bob, c => c.query('select user_id from public.bookings'));
    assert.ok(b.rows.every(r => r.user_id === users.bob));
    const all = await as(users.owner, c => c.query('select count(*)::int n from public.bookings'));
    assert.equal(all.rows[0].n, a.rowCount + b.rowCount);
    await assert.rejects(as(null, c => c.query('select * from public.bookings')), /permission denied/);
  });

  test('get_booked_slots is public and leaks no personal data', async () => {
    const r = await as(null, c => c.query(`select * from public.get_booked_slots($1, $1)`, [TOMORROW]));
    assert.ok(r.rowCount >= 4);
    assert.deepEqual(Object.keys(r.rows[0]).sort(), ['booking_date', 'duration_hours', 'room_id', 'start_hour']);
  });

  test('input validation', async () => {
    await rejectsWithHint(book(users.bob, { room: 'vr' }), 'ROOM_NOT_BOOKABLE');
    await rejectsWithHint(book(users.bob, { room: 'race', players: 2, start: 20 }), 'INVALID_PLAYERS');
    await rejectsWithHint(book(users.bob, { dur: 5, start: 12 }), 'INVALID_DURATION');
    await rejectsWithHint(book(users.bob, { start: 11 }), 'INVALID_TIME');                // before opening
    await rejectsWithHint(book(users.bob, { start: 23, dur: 2 }), 'INVALID_TIME');       // would cross midnight
    await rejectsWithHint(book(users.bob, { date: '2020-01-01' }), 'INVALID_DATE');
    const far = (await su.query(`select to_char((now() at time zone 'Asia/Kolkata')::date + 7, 'YYYY-MM-DD') d`)).rows[0].d;
    await rejectsWithHint(book(users.bob, { date: far }), 'INVALID_DATE');
    await rejectsWithHint(book(users.bob, { start: 21, phone: '12345' }), 'INVALID_PHONE');
    await rejectsWithHint(book(users.bob, { start: 21, email: 'nope' }), 'INVALID_EMAIL');
    await rejectsWithHint(book(users.bob, { start: 21, name: '   ' }), 'INVALID_NAME');
    await rejectsWithHint(book(users.bob, { start: 21, foods: ['Caviar'] }), 'INVALID_FOOD');
  });

  test('a slot that already started (past the 15-min grace) cannot be booked', async () => {
    const { rows } = await su.query(`select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') d,
      extract(hour from now() at time zone 'Asia/Kolkata')::int h`);
    const { d, h } = rows[0];
    if (h > 12) await rejectsWithHint(book(users.bob, { date: d, start: 12 }), 'SLOT_PASSED');
  });
});

// ---------------------------------------------------------------------------
describe('coupons, passes, holds, cancellation and admin status changes', () => {
  before(clearBookings);

  test('promo codes are validated and priced on the server', async () => {
    const ok = await as(null, c => c.query(`select public.validate_coupon('warp15') v`));
    assert.deepEqual(ok.rows[0].v, { valid: true, code: 'WARP15', percent_off: 15, message: '15% OFF APPLIED' });
    const bad = await as(null, c => c.query(`select public.validate_coupon('FREEPS5') v`));
    assert.equal(bad.rows[0].v.valid, false);

    const b = await book(users.alice, { start: 12, dur: 2, players: 4, coupon: 'warp15' });
    assert.equal(b.gaming_amount, 998);
    assert.equal(b.discount_amount, 150);   // round(998 * 0.15)
    assert.equal(b.total_amount, 848);
    await rejectsWithHint(book(users.alice, { start: 18, coupon: 'FREEPS5' }), 'COUPON_INVALID');
  });

  test('gaming passes: verified, room-restricted, hours-limited, and promo ignored', async () => {
    const p = await book(users.bob, { start: 18, dur: 2, pass: 'nl-p-1234', last4: '4321', coupon: 'WARP15' });
    assert.equal(p.total_amount, 0);
    assert.equal(p.coupon_code, null);
    await rejectsWithHint(book(users.bob, { start: 20, pass: 'NL-P-1234', last4: '0000' }), 'PASS_INVALID');
    await rejectsWithHint(book(users.bob, { room: 'race', start: 20, pass: 'NL-P-1234', last4: '4321' }), 'PASS_WRONG_ROOM');
    // 10 h pass: 2 h reserved above, so 4 h + 4 h fits … and one more hour doesn't
    await book(users.racer1, { room: 'pr2', start: 12, dur: 4, pass: 'NL-P-1234', last4: '4321' });
    await book(users.racer2, { room: 'pr2', start: 16, dur: 4, pass: 'NL-P-1234', last4: '4321' });
    await rejectsWithHint(book(users.racer3, { room: 'pr2', start: 20, dur: 1, pass: 'NL-P-1234', last4: '4321' }), 'PASS_HOURS');
  });

  test('an expired hold no longer blocks the slot', async () => {
    const old = await book(users.racer4, { room: 'race', start: 12 });
    await rejectsWithHint(book(users.racer5, { room: 'race', start: 12 }), 'SLOT_TAKEN');
    await su.query(`update public.bookings set hold_expires_at = now() - interval '1 second' where id = $1`, [old.id]);
    const fresh = await book(users.racer5, { room: 'race', start: 12 });
    assert.equal(fresh.status, 'held');
    const { rows } = await su.query(`select status from public.bookings where id = $1`, [old.id]);
    assert.equal(rows[0].status, 'expired');
  });

  test('customers can cancel their own upcoming booking — and only their own', async () => {
    const b = await book(users.racer6, { room: 'race', start: 14 });
    await rejectsWithHint(as(users.alice, c => c.query(`select public.cancel_my_booking($1)`, [b.id])), 'NOT_FOUND');
    const r = await as(users.racer6, c => c.query(`select status from public.cancel_my_booking($1)`, [b.id]));
    assert.equal(r.rows[0].status, 'cancelled');
    await book(users.racer7, { room: 'race', start: 14 });   // slot is free again
  });

  test('admin status changes: admin-only, valid transitions, pass hours charged once', async () => {
    const b = await book(users.racer8, { room: 'race', start: 16 });
    await rejectsWithHint(as(users.racer8, c => c.query(`select public.admin_set_booking_status($1, 'confirmed')`, [b.id])), 'FORBIDDEN');
    const conf = await as(users.owner, c => c.query(`select * from public.admin_set_booking_status($1, 'confirmed', 'Paid via UPI')`, [b.id]));
    assert.equal(conf.rows[0].status, 'confirmed');
    assert.equal(conf.rows[0].hold_expires_at, null);
    assert.equal(conf.rows[0].admin_note, 'Paid via UPI');
    await rejectsWithHint(as(users.owner, c => c.query(`select public.admin_set_booking_status($1, 'held')`, [b.id])), 'INVALID_TRANSITION');

    // cancel, let someone else take the slot, then try to re-confirm the old one
    await as(users.owner, c => c.query(`select public.admin_set_booking_status($1, 'cancelled')`, [b.id]));
    await book(users.racer9, { room: 'race', start: 16 });
    await rejectsWithHint(as(users.owner, c => c.query(`select public.admin_set_booking_status($1, 'confirmed')`, [b.id])), 'SLOT_TAKEN');

    // pass hours are charged at check-in, exactly once
    const { rows: [pb] } = await su.query(`select id from public.bookings where pass_id is not null and status = 'held' order by start_hour limit 1`);
    const before = (await su.query(`select hours_used from public.passes where code = 'NL-P-1234'`)).rows[0].hours_used;
    await as(users.owner, c => c.query(`select public.admin_set_booking_status($1, 'confirmed')`, [pb.id]));
    await as(users.owner, c => c.query(`select public.admin_set_booking_status($1, 'checked_in')`, [pb.id]));
    await as(users.owner, c => c.query(`select public.admin_set_booking_status($1, 'completed')`, [pb.id]));
    const afterH = (await su.query(`select hours_used from public.passes where code = 'NL-P-1234'`)).rows[0].hours_used;
    const dur = (await su.query(`select duration_hours from public.bookings where id = $1`, [pb.id])).rows[0].duration_hours;
    assert.equal(Number(afterH) - Number(before), dur);
  });

  test('fair-use limit: max 4 active bookings per customer', async () => {
    const u = await createUser('spammer');
    for (const start of [12, 13, 14, 15]) await book(u, { room: 'pr1', start, date: DAY2 });
    await rejectsWithHint(book(u, { room: 'pr2', start: 12, date: DAY2 }), 'TOO_MANY_BOOKINGS');
  });

  test('expire_stale_holds() sweeps old holds and is not callable by API users', async () => {
    await su.query(`update public.bookings set hold_expires_at = now() - interval '1 minute' where status = 'held'`);
    const n = (await su.query(`select public.expire_stale_holds() n`)).rows[0].n;
    assert.ok(n > 0);
    await assert.rejects(as(users.owner, c => c.query('select public.expire_stale_holds()')), /permission denied/);
  });
});

// ---------------------------------------------------------------------------
describe('race conditions — many customers booking at the same instant', () => {
  before(clearBookings);

  /** Open N transactions, get them all to the starting line, then fire at once. */
  async function stampede(requests) {
    const clients = await Promise.all(requests.map(() => pool.connect()));
    try {
      // Everyone opens a transaction and authenticates first …
      await Promise.all(clients.map((c, i) => c.query('begin')
        .then(() => c.query('set local role authenticated'))
        .then(() => c.query(`select set_config('request.jwt.claims', $1, true)`,
          [JSON.stringify({ sub: requests[i].user, role: 'authenticated' })]))));
      // … then all fire create_booking simultaneously.
      const results = await Promise.all(clients.map((c, i) => {
        const b = { room: 'pr1', date: TOMORROW, start: 15, dur: 1, players: 1, coupon: null, pass: null, last4: null, ...requests[i] };
        return c.query(BOOK_SQL, [b.room, b.date, b.start, b.dur, b.players, 'Racer ' + i, '98765' + String(10000 + i).slice(-5),
          `racer${i}@example.com`, null, [], b.coupon, b.pass, b.last4])
          .then(async r => { await c.query('commit'); return { ok: true, row: r.rows[0] }; })
          .catch(async e => { await c.query('rollback'); return { ok: false, hint: e.hint, code: e.code, message: e.message }; });
      }));
      return results;
    } finally {
      clients.forEach(c => c.release());
    }
  }

  test('50 users grab the SAME slot at once → exactly one wins, 49 get SLOT_TAKEN', async () => {
    const reqs = Array.from({ length: 50 }, (_, i) => ({ user: users['racer' + i], room: 'pr1', start: 20, dur: 1 }));
    const results = await stampede(reqs);
    const wins = results.filter(r => r.ok);
    const losses = results.filter(r => !r.ok);
    assert.equal(wins.length, 1, 'exactly one booking succeeds');
    assert.ok(losses.every(l => l.hint === 'SLOT_TAKEN'), 'every loser gets a clean SLOT_TAKEN: ' + JSON.stringify(losses.find(l => l.hint !== 'SLOT_TAKEN')));
    const n = (await su.query(`select count(*)::int n from public.bookings where room_id='pr1' and booking_date=$1 and start_hour=20`, [TOMORROW])).rows[0].n;
    assert.equal(n, 1, 'exactly one row in the database');
  });

  test('overlapping-but-different slots at once → winners never overlap', async () => {
    // 60 requests: random starts 12–20 and durations 1–4 on the same room
    let seed = 42; const rnd = n => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    const reqs = Array.from({ length: 60 }, (_, i) => ({ user: users['racer' + i], room: 'pr2', start: 12 + rnd(9), dur: 1 + rnd(3) }));
    const results = await stampede(reqs);
    assert.ok(results.some(r => r.ok));
    assert.ok(results.filter(r => !r.ok).every(l => l.hint === 'SLOT_TAKEN'));
    assert.equal(await activeOverlaps(), 0, 'no two active bookings overlap');
  });

  test('a limited coupon is never over-redeemed under concurrency', async () => {
    await su.query(`update public.coupons set uses = 0, max_uses = 5 where code = 'LAUNCH50'`);
    // 30 users, 30 different (non-conflicting) slots across rooms/dates, all using LAUNCH50
    const reqs = Array.from({ length: 30 }, (_, i) => ({
      user: users['racer' + (i + 30)], room: ['pr1', 'pr2', 'race'][i % 3], start: 12 + (i % 10), dur: 1, coupon: 'LAUNCH50',
    }));
    await su.query(`delete from public.bookings`);
    const results = await stampede(reqs);
    const wins = results.filter(r => r.ok);
    assert.equal(wins.length, 5, 'only max_uses bookings get the coupon');
    assert.ok(results.filter(r => !r.ok).every(l => l.hint === 'COUPON_INVALID'));
    assert.equal((await su.query(`select uses from public.coupons where code='LAUNCH50'`)).rows[0].uses, 5);
  });

  test('a gaming pass is never over-spent under concurrency', async () => {
    await clearBookings();
    // 10 h pass, 12 concurrent 2 h bookings on non-conflicting slots → at most 5 fit
    const reqs = Array.from({ length: 12 }, (_, i) => ({
      user: users['racer' + i], room: i % 2 ? 'pr1' : 'pr2', start: 12 + 2 * Math.floor(i / 2), dur: 2, pass: 'NL-P-1234', last4: '4321',
    }));
    const results = await stampede(reqs);
    assert.equal(results.filter(r => r.ok).length, 5);
    assert.ok(results.filter(r => !r.ok).every(l => l.hint === 'PASS_HOURS'));
  });

  test('the exclusion constraint alone stops overlaps even if the function is bypassed', async () => {
    await clearBookings();
    const clients = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
    try {
      await Promise.all(clients.map(c => c.query('begin')));
      const res = await Promise.all(clients.map((c, i) => c.query(
        `insert into public.bookings (code, user_id, room_id, booking_date, start_hour, duration_hours, starts_at, ends_at, players,
           customer_name, customer_phone, customer_email, hourly_rate, gaming_amount, total_amount)
         select 'NL-RAW' || $1, $2, 'race', $3::date, 18, 1,
                ($3::date + time '18:00') at time zone 'Asia/Kolkata', ($3::date + time '19:00') at time zone 'Asia/Kolkata',
                1, 'Raw', '9999999999', 'raw@example.com', 199, 199, 199`, [i, users['racer' + i], TOMORROW])
        .then(() => c.query('commit').then(() => 'ok'))
        .catch(e => c.query('rollback').then(() => e.code))));
      assert.equal(res.filter(r => r === 'ok').length, 1);
      assert.ok(res.filter(r => r !== 'ok').every(code => code === '23P01'), 'losers hit exclusion_violation (23P01)');
    } finally {
      clients.forEach(c => c.release());
    }
  });
});
