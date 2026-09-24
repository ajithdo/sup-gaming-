import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchBookedSlots, fetchMyBookings, fetchRooms } from '../lib/api';
import { FALLBACK_ROOMS, ROOM_META, C } from '../config/site';

/** Re-render every `ms` milliseconds with the current timestamp. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Rooms from the database (prices, state), merged with their visual details. */
export function useRooms() {
  const [rows, setRows] = useState(FALLBACK_ROOMS);
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    fetchRooms().then(r => live && r?.length && setRows(r)).catch(e => console.warn('rooms:', e.message));
    return () => { live = false; };
  }, []);
  return useMemo(() => rows.map(r => ({
    ...r,
    ...(ROOM_META[r.id] || { icon: 'sports_esports', color: C.cyan, unit: 'per hour' }),
    rates: (r.rates || []).map(Number),
  })), [rows]);
}

/**
 * Booked hours for a date range (no personal data). Polls every 30 s and on focus,
 * so the slot picker stays close to live; the database re-checks on confirm anyway.
 */
export function useAvailability(from, to) {
  const [slots, setSlots] = useState([]);
  const [error, setError] = useState(null);
  const inflight = useRef(0);

  const refresh = useCallback(async () => {
    if (!supabase || !from || !to) return;
    const ticket = ++inflight.current;
    try {
      const data = await fetchBookedSlots(from, to);
      if (ticket === inflight.current) { setSlots(data || []); setError(null); }
    } catch (e) {
      if (ticket === inflight.current) setError(e);
    }
  }, [from, to]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    const onFocus = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const taken = useCallback((roomId, date, h, dur = 1) => slots.some(s =>
    s.room_id === roomId && s.booking_date === date && s.start_hour < h + dur && h < s.start_hour + s.duration_hours,
  ), [slots]);

  return { slots, taken, refresh, error };
}

/** The signed-in customer's bookings, kept live via Supabase Realtime. */
export function useMyBookings(userId) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase || !userId) { setBookings([]); return; }
    setLoading(true);
    try { setBookings(await fetchMyBookings(userId)); }
    catch (e) { console.warn('my bookings:', e.message); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!supabase || !userId) return undefined;
    const channel = supabase
      .channel('my-bookings-' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: 'user_id=eq.' + userId }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, refresh]);

  return { bookings, setBookings, refresh, loading };
}

/** Window width, for the few layout decisions CSS can't make on its own. */
export function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}
