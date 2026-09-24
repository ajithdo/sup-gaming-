import { useEffect, useRef, useState } from 'react';
import { C, CONTACT } from '../../config/site';
import { countdown, dNice, hLabel, inr } from '../../lib/time';
import { bookingWhatsApp, qrPayload } from '../../lib/links';
import { useQr } from '../../lib/useQr';
import { useNow } from '../../hooks/data';

/** How a booking should be shown to the customer right now. */
export function bookingView(b, now = Date.now()) {
  const holdLeft = b.hold_expires_at ? new Date(b.hold_expires_at).getTime() - now : null;
  const ended = new Date(b.ends_at).getTime() <= now;
  let status; let color;
  if (b.status === 'cancelled') { status = 'CANCELLED'; color = C.crimson; }
  else if (b.status === 'no_show') { status = 'NO-SHOW'; color = C.crimson; }
  else if (b.status === 'expired' || (b.status === 'held' && holdLeft !== null && holdLeft <= 0)) { status = 'EXPIRED'; color = '#94a3b8'; }
  else if (b.status === 'completed' || ended) { status = 'COMPLETED'; color = '#94a3b8'; }
  else if (b.status === 'checked_in') { status = 'CHECKED IN'; color = C.cyan; }
  else if (b.status === 'held') { status = holdLeft !== null ? 'HELD · ' + countdown(holdLeft) : 'AWAITING CONFIRMATION'; color = C.amber; }
  else { status = 'CONFIRMED'; color = C.emerald; }
  const active = ['HELD', 'AWAITING', 'CONFIRMED'].some(s => status.startsWith(s));
  return { status, color, active, holdLeft };
}

function BookingCard({ b, roomName, now, onCancel }) {
  const v = bookingView(b, now);
  const qr = useQr(qrPayload(b, roomName), 184);
  return (
    <div className={`nl-bcard ${v.active ? 'is-active' : 'is-inactive'}`}>
      {qr ? <img className="nl-bcard__qr" alt={'QR code for ' + b.code} src={qr} /> : <div className="nl-bcard__qr" />}
      <div className="nl-bcard__body">
        <div className="nl-bcard__top"><b>{b.code}</b><span style={{ color: v.color }}>{v.status}</span></div>
        <span className="nl-bcard__room">{roomName} · {b.players}P</span>
        <span className="nl-bcard__when">{dNice(b.booking_date)} · {hLabel(b.start_hour)} ({b.duration_hours}h)</span>
        <span className="nl-bcard__total">{b.pass_code ? 'Pass ' + b.pass_code : inr(b.total_amount) + ' · pay at lounge'}</span>
        {v.active && (
          <div className="nl-bcard__actions">
            <a className="nl-bcard__wa" href={bookingWhatsApp(b, roomName)} target="_blank" rel="noopener noreferrer">WHATSAPP</a>
            <button type="button" className="nl-bcard__cancel" onClick={() => onCancel(b)}>CANCEL</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MyBookings({ user, configured, bookings, roomName, onSignIn, onBook, onCancel }) {
  const now = useNow(1000);
  return (
    <section id="my-bookings" className="nl-section" data-screen-label="10 My Bookings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        <span className="nl-eyebrow" style={{ color: C.violet }}>MEMBER PORTAL</span>
        <h2 className="nl-h2" style={{ margin: 0 }}>YOUR BOOKINGS</h2>
        <p className="nl-lead" style={{ fontSize: 14 }}>
          {user ? 'Bookings on your account. Show the QR card at the counter to check in.' : 'Sign in to see your bookings on any device. Show the QR card at the counter to check in.'}
        </p>
      </div>
      {!user ? (
        <div className="nl-mybookings__empty">
          <span>{configured ? 'You’re not signed in.' : 'Online bookings aren’t connected yet.'}</span>
          {configured && <button type="button" className="nl-violet-btn" onClick={onSignIn}>SIGN IN</button>}
        </div>
      ) : bookings.length === 0 ? (
        <div className="nl-mybookings__empty">
          <span>No bookings yet.</span>
          <a href="#booking" className="nl-violet-btn" onClick={onBook}>BOOK YOUR FIRST SESSION</a>
        </div>
      ) : (
        <div className="nl-bookings">
          {bookings.map(b => <BookingCard key={b.id} b={b} roomName={roomName(b.room_id)} now={now} onCancel={onCancel} />)}
        </div>
      )}
    </section>
  );
}

export function HoldModal({ booking: b, roomName, onClose, onCancel }) {
  const now = useNow(1000);
  const qr = useQr(b ? qrPayload(b, roomName) : '', 256);
  const doneRef = useRef(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    doneRef.current?.focus();
    const esc = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  if (!b) return null;
  const v = bookingView(b, now);
  const held = b.status === 'held';

  return (
    <div className="nl-modal" role="dialog" aria-modal="true" aria-labelledby="hold-title" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="nl-modal__card">
        <span className="nl-modal__eyebrow">BOOKING {b.code}</span>
        <h3 id="hold-title">{held ? (v.status === 'EXPIRED' ? 'HOLD EXPIRED' : 'SLOT HELD ⏳') : v.status}</h3>
        {held && v.status !== 'EXPIRED' && (
          <p>Your slot is held{v.holdLeft !== null && <> for <b>{countdown(v.holdLeft)}</b></>}. Confirm on WhatsApp so we can lock it — pay at the lounge.</p>
        )}
        {v.status === 'EXPIRED' && <p>The hold ran out. Message us on WhatsApp and we’ll check if the slot is still free.</p>}
        <div className="nl-modal__rows">
          <div><span>ROOM</span><span style={{ color: '#fff', fontWeight: 700 }}>{roomName} · {b.players}P</span></div>
          <div><span>WHEN</span><span style={{ color: 'var(--cyan)', textAlign: 'right' }}>{dNice(b.booking_date)} · {hLabel(b.start_hour)} ({b.duration_hours}h)</span></div>
          <div><span>TOTAL</span><span style={{ color: 'var(--orange)', fontWeight: 800 }}>{b.pass_code ? 'Gaming pass' : inr(b.total_amount)}</span></div>
        </div>
        {qr && <img className="nl-modal__qr" alt="Check-in QR" src={qr} />}
        <a className="nl-wa-btn" href={bookingWhatsApp(b, roomName)} target="_blank" rel="noopener noreferrer">CONFIRM ON WHATSAPP</a>
        <div className="nl-modal__pair">
          <a className="nl-modal__call" href={CONTACT.phoneHref}>CALL US</a>
          <button ref={doneRef} type="button" className="nl-modal__done" onClick={onClose}>DONE — LET&apos;S GAME</button>
        </div>
        {v.active && (
          <button type="button" className="nl-linkbtn" disabled={cancelling}
            onClick={async () => { setCancelling(true); try { await onCancel(b); onClose(); } finally { setCancelling(false); } }}>
            {cancelling ? 'Cancelling…' : 'Cancel this booking'}
          </button>
        )}
      </div>
    </div>
  );
}

