// Thin wrappers around Supabase. Every write that matters goes through a Postgres
// function (RPC) so the database can validate, price and lock inside one transaction.
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(message, { code, hint } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

// Hints raised by our SQL functions already carry a customer-friendly message.
const OUR_HINTS = new Set([
  'AUTH_REQUIRED', 'ROOM_NOT_BOOKABLE', 'INVALID_PLAYERS', 'INVALID_DURATION', 'INVALID_DATE', 'INVALID_TIME',
  'SLOT_PASSED', 'INVALID_NAME', 'INVALID_PHONE', 'INVALID_EMAIL', 'INVALID_GAME_REQUEST', 'INVALID_FOOD',
  'SLOT_TAKEN', 'TOO_MANY_BOOKINGS', 'PASS_INVALID', 'PASS_EXPIRED', 'PASS_WRONG_ROOM', 'PASS_HOURS',
  'COUPON_INVALID', 'RETRY', 'NOT_FOUND', 'NOT_CANCELLABLE', 'FORBIDDEN', 'INVALID_TRANSITION',
  'SELF_ROLE_CHANGE', 'INVALID_ROLE',
]);

function toApiError(error) {
  if (!error) return new ApiError('Something went wrong.');
  const { code, hint, message = '' } = error;
  if (hint && OUR_HINTS.has(hint)) return new ApiError(message, { code, hint });
  if (code === '42501' || /permission denied|row-level security/i.test(message)) {
    return new ApiError('You don’t have permission to do that.', { code, hint: 'FORBIDDEN' });
  }
  if (code === 'PGRST301' || /jwt expired/i.test(message)) {
    return new ApiError('Your session expired — please sign in again.', { code, hint: 'AUTH_REQUIRED' });
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return new ApiError('Can’t reach the booking server. Check your connection and try again.', { code, hint: 'NETWORK' });
  }
  if (code === '23505') return new ApiError('That already exists.', { code, hint: 'DUPLICATE' });
  if (code === '23514' || code === '22P02') return new ApiError('Some of those values aren’t valid.', { code, hint: 'INVALID' });
  return new ApiError(message || 'Something went wrong.', { code, hint });
}

function db() {
  if (!supabase) {
    throw new ApiError('Online booking isn’t connected yet — please call or WhatsApp us to book.', { hint: 'NOT_CONFIGURED' });
  }
  return supabase;
}

async function run(promise) {
  const { data, error } = await promise;
  if (error) throw toApiError(error);
  return data;
}

// ---------------------------------------------------------------- public ---
export const fetchRooms = () =>
  run(db().from('rooms').select('id,name,subtitle,state,rates,pass_kind,sort_order').order('sort_order'));

export const fetchBookedSlots = (from, to) =>
  run(db().rpc('get_booked_slots', { p_from: from, p_to: to }));

export const validateCoupon = code =>
  run(db().rpc('validate_coupon', { p_code: code }));

// ------------------------------------------------------------- customers ---
export const createBooking = b =>
  run(db().rpc('create_booking', {
    p_room_id: b.roomId,
    p_date: b.date,
    p_start_hour: b.startHour,
    p_duration_hours: b.duration,
    p_players: b.players,
    p_name: b.name,
    p_phone: b.phone,
    p_email: b.email,
    p_game_request: b.gameRequest || null,
    p_foods: b.foods || [],
    p_coupon_code: b.couponCode || null,
    p_pass_code: b.passCode || null,
    p_pass_last4: b.passLast4 || null,
  }));

export const cancelMyBooking = id => run(db().rpc('cancel_my_booking', { p_booking_id: id }));

export const fetchMyBookings = userId =>
  run(db().from('bookings').select('*').eq('user_id', userId).order('starts_at', { ascending: false }).limit(30));

export const updateMyProfile = (userId, patch) =>
  run(db().from('profiles').update(patch).eq('id', userId).select().single());

// ----------------------------------------------------------------- admin ---
// These only succeed for admins: RLS policies and is_admin() checks in the
// database enforce it, whatever the browser does.
export const adminFetchBookings = ({ from, to }) => {
  let q = db().from('bookings').select('*').order('starts_at', { ascending: true }).limit(2000);
  if (from) q = q.gte('booking_date', from);
  if (to) q = q.lte('booking_date', to);
  return run(q);
};

export const adminSetBookingStatus = (id, status, note) =>
  run(db().rpc('admin_set_booking_status', { p_booking_id: id, p_status: status, p_note: note || null }));

export const adminFetchProfiles = () =>
  run(db().from('profiles').select('id,email,full_name,phone,role,created_at').order('created_at', { ascending: false }).limit(1000));

export const adminSetUserRole = (userId, role) =>
  run(db().rpc('admin_set_user_role', { p_user_id: userId, p_role: role }));

export const adminFetchCoupons = () =>
  run(db().from('coupons').select('*').order('created_at', { ascending: false }));

export const adminCreateCoupon = c => run(db().from('coupons').insert(c).select().single());

export const adminUpdateCoupon = (code, patch) =>
  run(db().from('coupons').update(patch).eq('code', code).select().single());

export const adminFetchPasses = () =>
  run(db().from('passes').select('*').order('created_at', { ascending: false }));

export const adminCreatePass = p => run(db().from('passes').insert(p).select().single());

export const adminUpdatePass = (id, patch) =>
  run(db().from('passes').update(patch).eq('id', id).select().single());

export const adminUpdateRoom = (id, patch) =>
  run(db().from('rooms').update(patch).eq('id', id).select().single());
