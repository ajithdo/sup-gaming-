import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SiteHeader from '../components/SiteHeader';
import Hero from '../components/sections/Hero';
import { Experience, Claim, Games, Food, Passes, Testimonials, Contact, FinalCta } from '../components/sections/Static';
import { Rooms, LiveStatus } from '../components/sections/Rooms';
import Booking, { validateForm } from '../components/sections/Booking';
import { MyBookings, HoldModal } from '../components/sections/MyBookings';
import AuthModal from '../auth/AuthModal';
import { useAuth } from '../auth/AuthProvider';
import { useAvailability, useMyBookings, useNow, useRooms } from '../hooks/data';
import { useSlipScene } from '../scene/useSlipScene';
import { cancelMyBooking, createBooking, validateCoupon } from '../lib/api';
import { dNice, dateKeys, isOpenNow, todayKey, venueParts } from '../lib/time';
import { C } from '../config/site';

const EMPTY_FORM = {
  room: 'pr1', players: 1, dateIdx: 0, dur: 1, start: null,
  name: '', phone: '', email: '', gameReq: '', foods: [],
  hasPass: false, passId: '', passLast4: '',
  promoInput: '', promo: null, promoMsg: '',
};

export default function Home() {
  const { user, profile, configured } = useAuth();
  const now = useNow(15000);
  const rooms = useRooms();
  const dates = useMemo(() => dateKeys(now), [now]);
  const today = dates[0];
  const { taken, refresh: refreshSlots } = useAvailability(dates[0], dates[dates.length - 1]);
  const { bookings, setBookings } = useMyBookings(user?.id);

  // ---- 3D scene + anchors
  const mountRef = useRef(null), heroRef = useRef(null), heroSlotRef = useRef(null), claimSlotRef = useRef(null), bookSlotRef = useRef(null);
  const scene = useSlipScene({ mountRef, heroRef, heroSlotRef, claimSlotRef, bookSlotRef });

  // ---- booking form
  const [form, setForm] = useState(EMPTY_FORM);
  const patch = useCallback(p => setForm(f => ({ ...f, ...p })), []);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [promoBusy, setPromoBusy] = useState(false);
  const [modalBooking, setModalBooking] = useState(null);
  const [auth, setAuth] = useState({ open: false, then: null });

  // Prefill contact details from the signed-in profile (never overwrite typing).
  useEffect(() => {
    if (!user) return;
    setForm(f => ({
      ...f,
      name: f.name || profile?.full_name || '',
      phone: f.phone || profile?.phone || '',
      email: f.email || profile?.email || user.email || '',
    }));
  }, [user, profile]);

  // If an admin marks the selected room "coming soon" / walk-in, switch to a bookable one.
  useEffect(() => {
    const current = rooms.find(r => r.id === form.room);
    if (current && current.state !== 'book') {
      const first = rooms.find(r => r.state === 'book');
      if (first) patch({ room: first.id, players: Math.min(form.players, first.rates.length), start: null });
    }
  }, [rooms, form.room, form.players, patch]);

  // If the chosen date rolls off the 7-day window (open overnight), reset to today.
  useEffect(() => { if (form.dateIdx >= dates.length) patch({ dateIdx: 0, start: null }); }, [dates, form.dateIdx, patch]);

  // ---- live status
  const open = isOpenNow(now);
  const nowHour = venueParts(now).h;
  const bookable = rooms.filter(r => r.state === 'book');
  const freeRooms = bookable.filter(r => open && !taken(r.id, today, nowHour));
  const live = {
    color: open ? C.emerald : C.amber,
    pill: open ? `${freeRooms.length}/${bookable.length} ROOMS FREE` : 'OPENS 12 PM',
    freeNow: open ? `${freeRooms.length}/${bookable.length}` : 'CLOSED',
    freeNowSub: open ? 'rooms free' : 'opens 12 PM',
  };
  const roomName = useCallback(id => rooms.find(r => r.id === id)?.name || id, [rooms]);
  // Keep the open modal in sync with live updates (e.g. an admin confirms the hold).
  const modalRow = modalBooking ? (bookings.find(b => b.id === modalBooking.id) || modalBooking) : null;

  // ---- actions
  const pickRoom = (roomId, e) => { patch({ room: roomId, players: 1, start: null }); scene.bookFly(e); };
  const pickCell = (roomId, date, h, e) => {
    const r = rooms.find(x => x.id === roomId);
    patch({ room: roomId, dateIdx: Math.max(0, dates.indexOf(date)), start: h, players: Math.min(form.players, r.rates.length) });
    setError('');
    scene.bookFly(e);
  };

  const applyPromo = async () => {
    const code = form.promoInput.trim();
    if (!code) { patch({ promo: null, promoMsg: '' }); return; }
    setPromoBusy(true);
    try {
      const res = await validateCoupon(code);
      patch(res.valid ? { promo: { code: res.code, percent_off: res.percent_off }, promoMsg: res.message } : { promo: null, promoMsg: res.message });
    } catch (e) {
      patch({ promo: null, promoMsg: e.message });
    } finally {
      setPromoBusy(false);
    }
  };

  const submitBooking = useCallback(async (f = form) => {
    setSubmitting(true); setError(''); setNotice('');
    try {
      const b = await createBooking({
        roomId: f.room, date: dates[f.dateIdx], startHour: f.start, duration: f.dur, players: f.players,
        name: f.name.trim(), phone: f.phone, email: f.email.trim(), gameRequest: f.gameReq.trim(), foods: f.foods,
        couponCode: f.hasPass ? null : f.promo?.code, passCode: f.hasPass ? f.passId.trim() : null, passLast4: f.hasPass ? f.passLast4 : null,
      });
      setBookings(list => [b, ...list.filter(x => x.id !== b.id)]);
      setModalBooking(b);
      patch({ start: null });
      scene.pulse();
    } catch (e) {
      setError(e.message);
      if (e.hint === 'SLOT_TAKEN' || e.hint === 'SLOT_PASSED') patch({ start: null });
      if (e.hint === 'COUPON_INVALID') patch({ promo: null, promoMsg: e.message });
      if (e.hint === 'AUTH_REQUIRED') setAuth({ open: true, then: 'book' });
    } finally {
      setSubmitting(false);
      refreshSlots();
    }
  }, [form, dates, patch, refreshSlots, scene, setBookings]);

  const confirm = () => {
    const errs = validateForm(form, { date: dates[form.dateIdx], taken, now: Date.now() });
    if (errs.length) { setError(errs.join(' ')); return; }
    setError('');
    if (!configured) { setError('Online booking isn’t connected yet — please call or WhatsApp us to book.'); return; }
    if (!user) {
      setNotice('Sign in (or create an account) to lock this slot — your details are kept.');
      setAuth({ open: true, then: 'book' });
      return;
    }
    submitBooking();
  };

  // After signing in from the booking flow, finish the booking automatically.
  useEffect(() => {
    if (user && auth.then === 'book' && !auth.open) {
      setAuth({ open: false, then: null });
      submitBooking();
    }
  }, [user, auth, submitBooking]);

  const cancel = async b => {
    if (!window.confirm(`Cancel booking ${b.code}?`)) return;
    try {
      const updated = await cancelMyBooking(b.id);
      setBookings(list => list.map(x => (x.id === updated.id ? updated : x)));
      refreshSlots();
    } catch (e) {
      window.alert(e.message);
    }
  };

  return (
    <div className="nl-page">
      <div ref={mountRef} className="nl-scene" />
      <div className="nl-vignette" />
      <SiteHeader live={live} onBook={scene.bookFly} onSignIn={() => setAuth({ open: true, then: null })} />

      <main id="top" className="nl-main">
        <Hero ref={heroRef} slotRef={heroSlotRef} live={live} scene={scene} onBook={scene.bookFly} />
        <Experience />
        <Rooms rooms={rooms} open={open} today={today} nowHour={nowHour} taken={taken} onPickRoom={pickRoom} />
        <Claim ref={claimSlotRef} onBook={scene.bookFly} />
        <LiveStatus rooms={rooms} open={open} today={today} todayLabel={dNice(todayKey(now)).toUpperCase()} nowHour={nowHour} now={now} taken={taken} onPickCell={pickCell} />
        <Games />
        <Food />
        <Passes />
        <Booking ref={bookSlotRef} form={form} patch={patch} rooms={rooms.length ? rooms : []} dates={dates} taken={taken} now={now}
          user={user} submitting={submitting} error={error} notice={notice} onConfirm={confirm} onApplyPromo={applyPromo} promoBusy={promoBusy} />
        <MyBookings user={user} configured={configured} bookings={bookings} roomName={roomName}
          onSignIn={() => setAuth({ open: true, then: null })} onBook={scene.bookFly} onCancel={cancel} />
        <Testimonials />
        <Contact />
        <FinalCta onBook={scene.bookFly} />
      </main>

      {modalRow && (
        <HoldModal booking={modalRow} roomName={roomName(modalRow.room_id)} onClose={() => setModalBooking(null)} onCancel={cancel} />
      )}
      <AuthModal
        open={auth.open}
        subtitle={auth.then === 'book' ? 'Sign in or create an account to confirm your booking. It takes a few seconds.' : 'Book faster and see your bookings on any device.'}
        defaults={{ email: form.email, name: form.name, phone: form.phone }}
        onClose={() => setAuth({ open: false, then: null })}
        onSignedIn={() => { setNotice(''); setAuth(a => ({ ...a, open: false })); }}
      />
      {!configured && (
        <div className="nl-configbar">⚠ Supabase isn’t configured — showing the site without live data. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local.</div>
      )}
    </div>
  );
}
