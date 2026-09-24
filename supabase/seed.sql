-- Local development seed (runs on `supabase db reset`, never in production).
-- Rooms, venue settings and the WARP15 promo are created by the migrations.

-- A demo gaming pass for testing the "Have a gaming pass?" flow:
--   Pass ID: NL-P-1234   ·   Last 4 digits of pass phone: 4321
insert into public.passes (code, kind, holder_name, holder_phone, hours_total, valid_until, notes)
values ('NL-P-1234', 'private', 'Demo Pass Holder', '9876544321', 10, current_date + 30, 'Seeded demo pass')
on conflict (code) do nothing;

-- An expiring demo coupon
insert into public.coupons (code, description, percent_off, max_uses)
values ('LAUNCH50', 'Demo: 50% off, first 5 bookings', 50, 5)
on conflict (code) do nothing;
