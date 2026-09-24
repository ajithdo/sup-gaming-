// End-to-end test: real browser + real Supabase stack (Auth + REST + Postgres).
//
// 1. `npx supabase start` (Docker) — then `npx supabase db reset` to apply migrations + seed
// 2. In another terminal: VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=<anon key> npm run dev
// 3. SUPABASE_ANON_KEY=<anon key> npm run test:e2e
//
// Env (defaults match `supabase start`):
//   APP_URL            http://127.0.0.1:5173
//   SUPABASE_URL       http://127.0.0.1:54321
//   SUPABASE_ANON_KEY  (required — printed by `supabase start` / `supabase status`)
//   DATABASE_URL       postgresql://postgres:postgres@127.0.0.1:54322/postgres
//   CHROMIUM_PATH      optional path to a Chromium binary
//
// ⚠️ Deletes all bookings in that database first. Never point it at production.
import pg from 'pg';
import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173';
const API = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const DB = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!ANON) { console.error('Set SUPABASE_ANON_KEY (see `npx supabase status`).'); process.exit(1); }
if (!/127\.0\.0\.1|localhost/.test(DB)) { console.error('Refusing to run against a non-local database.'); process.exit(1); }

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q1 = async (sql, params) => (await db.query(sql, params)).rows[0];
let failed = 0;
const ok = (cond, msg) => { console.log(cond ? '✅' : '❌', msg); if (!cond) failed++; };
const stamp = Date.now().toString(36);

await db.query('delete from public.bookings; update public.coupons set uses = 0');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.requests = [];
  page.on('request', r => page.requests.push(r.url()));
  return page;
}

try {
  // ------------------------------------------------------------ signed out --
  const anon = await newPage();
  await anon.goto(APP + '/admin');
  await anon.waitForURL(/\/login\?next=%2Fadmin/, { timeout: 15000 });
  ok(true, 'signed-out visitor hitting /admin is redirected to /login?next=/admin');
  ok(!anon.requests.some(u => u.includes('AdminDashboard')), 'admin code is never downloaded for a signed-out visitor');

  // ------------------------------------------------- customer books a slot --
  const alice = await newPage();
  await alice.goto(APP + '/');
  ok(await alice.locator('.nl-admin-btn').count() === 0, 'no ADMIN button when signed out');
  await alice.locator('#booking').scrollIntoViewIfNeeded();
  await alice.getByRole('button', { name: /Private Room 2/ }).click();
  await alice.getByRole('button', { name: /Duo · 2P/ }).click();
  await alice.locator('.nl-dates .nl-pick').nth(1).click();
  await alice.getByRole('button', { name: '2 HRS' }).click();
  await alice.locator('.nl-slot', { hasText: '6:00 PM' }).click();
  await alice.getByPlaceholder('Your name').fill('Alice Gamer');
  await alice.getByPlaceholder('10-digit mobile').first().fill('+91 98765 11111');
  await alice.getByPlaceholder('you@example.com').first().fill(`alice.${stamp}@example.com`);
  await alice.getByLabel('Promo code').fill('warp15');
  await alice.getByRole('button', { name: 'APPLY' }).click();
  await alice.getByText('15% OFF APPLIED').waitFor();
  ok((await alice.locator('.nl-manifest__total').innerText()).includes('₹508'), 'promo validated by the server: ₹598 → ₹508');
  await alice.getByRole('button', { name: /CONFIRM BOOKING/ }).click();
  await alice.getByRole('dialog', { name: 'Sign in' }).waitFor();
  await alice.getByRole('tab', { name: 'NEW ACCOUNT' }).click();
  await alice.getByLabel('PASSWORD').fill('correct-horse-42');
  await alice.getByRole('button', { name: 'CREATE ACCOUNT' }).click();
  await alice.getByText('SLOT HELD ⏳').waitFor({ timeout: 15000 });
  const code = (await alice.locator('.nl-modal__eyebrow').innerText()).replace('BOOKING ', '').trim();
  const row = await q1('select status, total_amount, discount_amount from public.bookings where code = $1', [code]);
  ok(row?.status === 'held' && row.total_amount === 508 && row.discount_amount === 90, `booking ${code} stored and priced server-side`);
  await alice.getByRole('button', { name: /DONE/ }).click();
  ok(await alice.locator('.nl-admin-btn').count() === 0, 'no ADMIN button for a customer');
  await alice.goto(APP + '/admin');
  await alice.getByText('ACCESS DENIED').waitFor();
  ok(true, 'customer visiting /admin gets ACCESS DENIED');
  ok(!alice.requests.some(u => u.includes('AdminDashboard')), 'admin code is never downloaded for a customer');

  // ---------------------------------------------------------------- admin --
  const owner = await newPage();
  await owner.goto(APP + '/login?mode=signup');
  await owner.getByLabel('NAME').fill('Owner');
  await owner.getByLabel('EMAIL').fill(`owner.${stamp}@example.com`);
  await owner.getByLabel('PASSWORD').fill('correct-horse-43');
  await owner.getByRole('button', { name: 'CREATE ACCOUNT' }).click();
  await owner.waitForURL(APP + '/');
  await db.query(`update public.profiles set role = 'admin' where email = $1`, [`owner.${stamp}@example.com`]);
  await owner.reload();
  await owner.locator('.nl-admin-btn').waitFor({ timeout: 10000 });
  ok(true, 'ADMIN button renders once the role is admin');
  await owner.locator('.nl-admin-btn').click();
  await owner.getByRole('button', { name: 'TOMORROW' }).click();
  await owner.locator('tr', { hasText: code }).getByRole('button', { name: 'CONFIRM' }).click();
  await owner.locator('.ad-ok', { hasText: code }).waitFor();
  ok((await q1('select status from public.bookings where code = $1', [code])).status === 'confirmed', 'admin confirmed the booking');

  // ------------------------------------------------ direct API attempts --
  const token = async (email, password) => (await (await fetch(API + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
  const tok = await token(`alice.${stamp}@example.com`, 'correct-horse-42');
  const rest = (path, init = {}, t = tok) => fetch(API + '/rest/v1' + path, { ...init, headers: { apikey: ANON, authorization: 'Bearer ' + t, 'content-type': 'application/json' } });
  const { id } = await q1('select id from public.bookings where code = $1', [code]);
  let r = await rest('/rpc/admin_set_booking_status', { method: 'POST', body: JSON.stringify({ p_booking_id: id, p_status: 'cancelled' }) });
  ok(r.status >= 400, `customer calling an admin RPC directly is refused (HTTP ${r.status})`);
  const me = await q1('select id from public.profiles where email = $1', [`alice.${stamp}@example.com`]);
  r = await rest('/profiles?id=eq.' + me.id, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) });
  ok(r.status >= 400, `customer promoting themselves is refused (HTTP ${r.status})`);

  // --------------------------------------------- race through the HTTP API --
  const tokens = await Promise.all(Array.from({ length: 25 }, async (_, i) => (await (await fetch(API + '/auth/v1/signup', {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `racer${i}.${stamp}@example.com`, password: 'correct-horse-99' }) })).json()).access_token));
  if (tokens.some(t => !t)) throw new Error('Sign-up returned no session — disable email confirmations for local testing.');
  const { d } = await q1(`select to_char((now() at time zone 'Asia/Kolkata')::date + 1, 'YYYY-MM-DD') d`);
  const results = await Promise.all(tokens.map((t, i) => rest('/rpc/create_booking', { method: 'POST', body: JSON.stringify({
    p_room_id: 'race', p_date: d, p_start_hour: 21, p_duration_hours: 1, p_players: 1,
    p_name: 'Racer ' + i, p_phone: '98765' + String(10000 + i), p_email: `racer${i}@example.com` }) }, t)
    .then(async res => ({ status: res.status, body: await res.json() }))));
  ok(results.filter(x => x.status === 200).length === 1, '25 simultaneous bookings for one slot → exactly 1 succeeds');
  ok(results.filter(x => x.status !== 200).every(x => x.body.hint === 'SLOT_TAKEN'), 'the other 24 get SLOT_TAKEN');
} finally {
  await browser.close();
  await db.end();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
