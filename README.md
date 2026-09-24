# NextLevel Gaming Zone — website, bookings & admin

React + Vite front end (ported from the *Gravity Pad / Next Level Site v2* design, including the 3D controller scene), backed by **Supabase**: Postgres, Auth, Row Level Security, and Postgres functions for all booking logic.

```
 Browser (React)                          Supabase
 ─────────────────                        ─────────────────────────────────────────────
 Home page ── get_booked_slots() ───────▶ public, read-only (no personal data)
 Booking   ── create_booking() ─────────▶ ONE transaction: lock → re-check slot → price → insert
 My bookings ─ select bookings ─────────▶ RLS: only your own rows
 /admin    ── admin_* RPCs / tables ────▶ is_admin() + RLS: admins only
 Auth      ── Supabase Auth (email) ────▶ auth.users ─trigger─▶ public.profiles (role = customer)
```

---

## What's in here

| Path | What it is |
| --- | --- |
| `supabase/migrations/…_core_schema.sql` | Tables, enums, constraints, RLS policies, roles (`profiles.role`), triggers |
| `supabase/migrations/…_booking_functions.sql` | `create_booking` (transactional), `get_booked_slots`, `validate_coupon`, `cancel_my_booking`, `admin_set_booking_status`, `admin_set_user_role` |
| `supabase/migrations/…_realtime_and_cron.sql` | Realtime for the admin dashboard; optional pg_cron job that expires old holds |
| `supabase/seed.sql` | Local-only demo data (a test pass `NL-P-1234` / last 4 `4321`, promo `LAUNCH50`) |
| `supabase/snippets/make_admin.sql` | Promote your first admin |
| `src/auth/` | `AuthProvider` (session + role), `RequireRole` (route guard), sign-in/up forms |
| `src/pages/Home.jsx` | The public site, wired to Supabase |
| `src/pages/admin/` | Admin dashboard (lazy-loaded, admins only) |
| `src/scene/` | The three.js controller scene, ported from the design |
| `src/config/site.js` | Contact details, games, menu, passes, copy — edit content here |
| `tests/db/` | 28 database tests incl. real concurrency tests (plain Postgres, no Docker) |
| `tests/e2e/` | Browser end-to-end test against a local Supabase stack |

---

## Setup (hosted Supabase)

1. **Create a project** at [supabase.com](https://supabase.com) (region *Mumbai* is closest to Hanamkonda).
   Use a **fresh project**. If you reuse the old site's project, check first for tables with the same names (`profiles`, `rooms`, `bookings`, `coupons`, `passes`).

2. **Create the database.** Pick one:
   - CLI: `npx supabase login` → `npx supabase link --project-ref <your-ref>` → `npx supabase db push`
   - Dashboard: **SQL Editor**, paste and run the three files in `supabase/migrations/` **in order**.

3. **Auth settings** (Dashboard → Authentication → URL Configuration):
   - *Site URL*: your live URL (e.g. `https://nextlevelgaming.in`)
   - *Redirect URLs*: add `https://<your-site>/reset-password` and `http://localhost:5173/reset-password`
   - Email confirmation is on by default. That's safer, but a new customer then has to confirm their email before their first booking goes through. For production, set up custom SMTP (Authentication → Emails) so those emails actually arrive.

4. **Environment.** `cp .env.example .env.local`, then fill in *Project URL* and the *publishable* (or legacy *anon*) key from Project Settings → API.
   Never put the `service_role`/secret key in a `VITE_` variable.

5. **Run it:** `npm install` then `npm run dev`, and open http://localhost:5173.

6. **Make yourself admin.** Sign up on the site, then run `supabase/snippets/make_admin.sql` (with your email) in the SQL Editor. Refresh and the **ADMIN** button appears. After that, you can promote other staff from *Admin → Users & Roles*.

7. **Optional: auto-expire holds.** Enable **pg_cron** (Database → Extensions) and re-run the last block of `…_realtime_and_cron.sql`. Without it the site still behaves correctly (expired holds never block a slot). The dashboard just shows them as expired until someone touches that slot.

8. **Deploy** (Vercel/Netlify/Cloudflare Pages): build with `npm run build`, publish `dist`, and set the two `VITE_SUPABASE_*` env vars. SPA rewrites are already included (`vercel.json`, `public/_redirects`), so `/admin` and `/login` survive a refresh.

### Local development with Docker (optional)
`npx supabase start` runs the full stack locally. Then `npx supabase db reset` applies the migrations and seed. Use the printed API URL and anon key in `.env.local`.

---

## How bookings stay consistent (no double bookings)

Everything happens inside **one Postgres function, `create_booking`**, which PostgREST runs as **one transaction**. If any step fails, nothing is written (no half-bookings, and no promo use without a booking).

1. **Validate**: room is bookable, 1–4 h, within opening hours and the 7-day window, not already started (15-min grace), phone/email/foods valid.
2. **Lock**: `pg_advisory_xact_lock` per customer, then per *(room, date)*. Concurrent requests for the same room and day queue up and run one at a time. Locks are always taken in the same order (no deadlocks) and are released on commit/rollback.
3. **Re-check availability while holding the lock**: holds that ran out are marked `expired`, then the function looks for any overlapping active booking. The function is `VOLATILE`, so under READ COMMITTED this check sees whatever the previous lock holder just committed. If the slot is taken, it raises `SLOT_TAKEN`.
4. **Price on the server**: the rate comes from `rooms.rates`. The promo code is re-validated with its row locked, so `max_uses` can't be exceeded. Pass hours are checked with the pass row locked, so two bookings can't spend the same hours. The browser's total is never trusted.
5. **Insert**, then commit.
6. **Safety net**: the exclusion constraint `bookings_no_overlap` (`EXCLUDE USING gist (room_id WITH =, slot WITH &&)` over active statuses) makes overlapping active bookings impossible even if someone bypasses the function. The function turns that error into `SLOT_TAKEN` as well.

**Proof (in `tests/db`)**
- 50 users book the same slot at the same instant: exactly 1 succeeds and 49 get `SLOT_TAKEN`.
- 60 random overlapping requests: the winners never overlap.
- A 5-use promo under 30 concurrent bookings is redeemed exactly 5 times. A 10-hour pass under 12 concurrent 2-hour bookings: exactly 5 succeed.
- Mutation check: with the lock and the constraint removed, these tests fail (double bookings appear). With only the constraint, overlaps are still blocked, but ~25% of losers hit Postgres deadlock errors instead of a clean `SLOT_TAKEN`. That's why both layers are used.

The e2e test repeats the race through the real HTTP API: 25 simultaneous `create_booking` calls produce 1 success and 24 `SLOT_TAKEN`.

---

## Authentication & role-based access

- **Supabase Auth** (email + password, password reset). Every new user gets a `profiles` row with `role = 'customer'` via a trigger. The role is **never** taken from sign-up metadata.
- **Roles:** `customer`, `admin` (`public.app_role` enum, stored in `profiles.role`).
- Customers **cannot change their own role**: there's no column privilege on `role`, plus a trigger that blocks API roles. Admins change roles with `admin_set_user_role()`, and can't change their own (to avoid lockouts).

| Layer | What it does |
| --- | --- |
| `RequireRole role="admin"` (`src/auth/RequireRole.jsx`) | Guards `/admin/*`. Signed out → `/login?next=/admin`. Wrong role → *Access denied*. While checking → a loading screen, so protected content never flashes. |
| Lazy admin bundle | The dashboard code is only downloaded after the guard confirms the admin role. Customers never receive it. |
| ADMIN button | `AdminButton` returns `null` unless `role === 'admin'` (header, account menu and mobile menu). |
| **Database (the real security)** | RLS policies + `is_admin()` checks in every admin function. A customer who crafts requests by hand still can't read other people's bookings, list coupons/passes, change statuses or promote themselves (all covered by tests). |

---

## Admin dashboard (`/admin`)

- **Bookings**: today / tomorrow / next 7 days / last 30 days, a "needs action" filter, and search. Confirm holds, check in, complete, mark no-show, cancel or restore. Updates live via Supabase Realtime. Pass hours are deducted at check-in.
- **Users & roles**: search accounts and grant or revoke admin.
- **Promo codes**: create codes (% off, max uses, expiry) and turn them on/off.
- **Passes**: issue passes, add hours, deactivate.
- **Rooms**: switch a room between bookable, coming soon and walk-in, and edit per-player hourly rates. New bookings use the new prices immediately.

## Business settings

Stored in the one-row table `public.venue_settings`. Change them in the SQL editor, for example:

```sql
update public.venue_settings set hold_minutes = 30;              -- 0 = holds never expire
update public.venue_settings set max_active_bookings_per_user = 6;
```

Other settings: `open_hour`, `last_start_hour`, `close_hour` (24 = sessions end by midnight), `max_duration_hours`, `booking_window_days`, `late_grace_minutes`, `food_options`.
If you change hours, also update `VENUE` in `src/config/site.js`, which drives the slot grid.

## RPC reference

| Function | Who | Purpose |
| --- | --- | --- |
| `get_booked_slots(p_from, p_to)` | anyone | Taken hours per room/date (no personal data) |
| `validate_coupon(p_code)` | anyone | `{ valid, percent_off, message }` |
| `create_booking(…)` | signed in | Transactional booking (see above). Errors carry a `hint` such as `SLOT_TAKEN`, `PASS_HOURS` or `COUPON_INVALID` |
| `cancel_my_booking(p_booking_id)` | owner | Cancel your own upcoming booking |
| `admin_set_booking_status(id, status, note)` | admin | Validated status transitions (re-checks the slot when restoring) |
| `admin_set_user_role(user_id, role)` | admin | Grant or revoke admin |

---

## Tests

```bash
# Database tests: any local Postgres 15+ where you can create databases
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:db
#   (with `supabase start`: postgresql://postgres:postgres@127.0.0.1:54322/postgres)

# Browser end-to-end: needs `supabase start` + `npm run dev` running
npx playwright install chromium
SUPABASE_ANON_KEY=<anon key from `npx supabase status`> npm run test:e2e
```

---

## Changes from the design prototype

- **Bookings live in Supabase**, not `localStorage`. *My Bookings* shows the account's bookings on any device and updates live.
- **Confirming a booking requires signing in.** Visitors can fill in the whole form first; the sign-in dialog appears on *Confirm* and the booking completes right after.
- **Promo codes (`WARP15`) and pricing moved to the server.**
- **Sessions can't run past midnight.** The design allowed e.g. 11 PM + 4 h; those slots now show `MAX 1H`.
- **Held bookings** keep the design's 10-minute hold. An admin confirms them (after the WhatsApp message), otherwise they expire.
- **Check-in QR codes** are generated in the browser (`qrcode` package) instead of `api.qrserver.com`, so booking data isn't sent to a third party.
- **Contact details**: the design's visible phone, email and Instagram text didn't match its links. Both now come from `CONTACT` in `src/config/site.js`, which uses the link values.
- **Performance**: the 3D model was compressed from 12.3 MB to 2.0 MB (meshopt + WebP, no visible difference), the logo and contact icons were resized (1.9 MB → 73 KB), and three.js loads lazily after the page renders.

## Before launch

- [ ] Confirm the phone, email, Instagram and WhatsApp number in `src/config/site.js`, and `whatsapp_number` in `venue_settings`.
- [ ] Replace the placeholder testimonials (`QUOTES`) with real Google reviews.
- [ ] Replace the hot-linked room and food photos (`lh3.googleusercontent.com`) with your own.
- [ ] Confirm the license of the PS5 controller model (Sketchfab).
- [ ] Set up custom SMTP in Supabase Auth, and consider enabling CAPTCHA for sign-ups.
- [ ] Enable pg_cron (step 7) if you want expired holds cleaned up automatically.
