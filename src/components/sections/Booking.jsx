import { forwardRef } from 'react';
import Icon from '../Icon';
import { C, MENU, PLAYER_LABELS, VENUE } from '../../config/site';
import { HOURS, dNice, dayChip, hLabel, inr, isPast } from '../../lib/time';

export function priceOf(room, form) {
  const rate = room.rates[form.players - 1] ?? room.rates[0] ?? 0;
  const gaming = rate * form.dur;
  const disc = form.promo && !form.hasPass ? Math.round(gaming * form.promo.percent_off / 100) : 0;
  return { rate, gaming, disc, total: form.hasPass ? 0 : gaming - disc };
}

/** Client-side checks (the database re-validates everything on confirm). */
export function validateForm(form, { date, taken, now }) {
  const errs = [];
  const phone = form.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (form.start == null) errs.push('Pick a time slot.');
  if (!form.name.trim()) errs.push('Enter your name.');
  if (!/^\d{10}$/.test(phone)) errs.push('Enter a valid 10-digit phone number.');
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.push('Enter a valid email.');
  if (form.hasPass && (!form.passId.trim() || !/^\d{4}$/.test(form.passLast4))) errs.push('Enter your pass ID and the last 4 digits of the pass phone.');
  if (form.start != null && (taken(form.room, date, form.start, form.dur) || isPast(date, form.start, now))) errs.push('That slot is no longer available — pick another.');
  return errs;
}

const Booking = forwardRef(function Booking(props, dockRef) {
  const { form, patch, rooms, dates, taken, now, user, submitting, error, notice, onConfirm, onApplyPromo, promoBusy } = props;
  const room = rooms.find(r => r.id === form.room) || rooms[0];
  const date = dates[form.dateIdx];
  const p = priceOf(room, form);
  const sel = on => (on ? 'is-on' : '');

  return (
    <section id="booking" className="nl-section" data-screen-label="09 Booking">
      <div className="nl-dock">
        <div ref={dockRef} className="nl-dock__slot" />
        <span>CONTROLLER DOCKED // RESERVE YOUR SESSION</span>
      </div>
      <div className="nl-booking__title">
        <h2>BOOK YOUR SLOT</h2>
        <p>Takes under 60 seconds. Pay at the lounge or confirm on WhatsApp.</p>
      </div>

      <div className="nl-booking">
        <div className="nl-form">
          {/* 01 room */}
          <div className="nl-step">
            <span className="nl-step__label">01 · PICK A ROOM</span>
            <div className="nl-roompicks">
              {rooms.map(r => {
                const can = r.state === 'book';
                const rates = !can ? (r.state === 'soon' ? 'Coming Soon' : 'Walk-In Only')
                  : r.rates.length > 1 ? r.rates.map((x, i) => `${PLAYER_LABELS[i]} ${inr(x)}`).join(' · ') + '/hr' : inr(r.rates[0]) + '/hr';
                return (
                  <button key={r.id} type="button" disabled={!can} className={`nl-roompick ${sel(form.room === r.id)}`} style={{ '--c': r.color }}
                    onClick={() => can && patch({ room: r.id, players: Math.min(form.players, r.rates.length), start: null })}>
                    <span className="nl-roompick__name"><Icon name={r.icon} />{r.name}</span>
                    <span className="nl-roompick__sub">{r.subtitle}</span>
                    <span className="nl-roompick__rates">{rates}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 02 players */}
          <div className="nl-step">
            <span className="nl-step__label">02 · PLAYERS</span>
            <div className="nl-players">
              {room.rates.map((rt, i) => (
                <button key={i} type="button" className={`nl-pick ${sel(form.players === i + 1)}`} onClick={() => patch({ players: i + 1 })}>
                  <span>{room.rates.length > 1 ? `${PLAYER_LABELS[i]} · ${i + 1}P` : '1 Player'}</span>
                  <span>{inr(rt)}/hr</span>
                </button>
              ))}
            </div>
          </div>

          {/* 03 date, duration, time */}
          <div className="nl-step">
            <span className="nl-step__label">03 · DATE, DURATION &amp; TIME</span>
            <div className="nl-dates">
              {dates.map((d, i) => {
                const chip = dayChip(d, i);
                return (
                  <button key={d} type="button" className={`nl-pick ${sel(form.dateIdx === i)}`} onClick={() => patch({ dateIdx: i, start: null })}>
                    <span>{chip.top}</span><span>{chip.day}</span>
                  </button>
                );
              })}
            </div>
            <div className="nl-durs">
              {Array.from({ length: VENUE.maxDuration }, (_, i) => i + 1).map(d => (
                <button key={d} type="button" className={`nl-pick ${sel(form.dur === d)}`}
                  onClick={() => patch({
                    dur: d,
                    start: form.start != null && (taken(form.room, date, form.start, d) || form.start + d > VENUE.closeHour) ? null : form.start,
                  })}>
                  {d + (d === 1 ? ' HR' : ' HRS')}
                </button>
              ))}
            </div>
            <div className="nl-slots">
              {HOURS.map(h => {
                const past = isPast(date, h, now);
                const tk = taken(form.room, date, h, form.dur);
                const late = h + form.dur > VENUE.closeHour;
                const on = form.start === h;
                const bad = past || tk || late;
                const status = on ? '★ SELECTED' : past ? 'PASSED' : tk ? '✕ BOOKED' : late ? `MAX ${VENUE.closeHour - h}H` : '● OPEN';
                return (
                  <button key={h} type="button" disabled={bad}
                    className={`nl-slot ${on ? 'is-on' : ''} ${bad ? 'is-bad' : ''} ${tk && !past ? 'is-taken' : ''}`}
                    onClick={() => !bad && patch({ start: h, error: '' })}>
                    <span>{hLabel(h)}</span><span>{status}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 04 details */}
          <div className="nl-step">
            <span className="nl-step__label">04 · YOUR DETAILS</span>
            <div className="nl-fields">
              <label className="nl-field">NAME
                <input className="nl-input" value={form.name} onChange={e => patch({ name: e.target.value })} type="text" autoComplete="name" placeholder="Your name" maxLength={80} />
              </label>
              <label className="nl-field">PHONE
                <input className="nl-input" value={form.phone} onChange={e => patch({ phone: e.target.value })} type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" maxLength={16} />
              </label>
              <label className="nl-field">EMAIL
                <input className="nl-input" value={form.email} onChange={e => patch({ email: e.target.value })} type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} />
              </label>
            </div>
            <label className="nl-field">GAME REQUEST (OPTIONAL)
              <input className="nl-input" value={form.gameReq} onChange={e => patch({ gameReq: e.target.value })} type="text" placeholder="We'll check if we can accommodate your request" maxLength={200} />
            </label>
          </div>

          {/* 05 food */}
          <div className="nl-step">
            <span className="nl-step__label" style={{ color: C.orange }}>05 · ADD FOOD &amp; DRINKS (OPTIONAL)</span>
            <div className="nl-foods">
              {MENU.map(m => {
                const on = form.foods.includes(m.name);
                return (
                  <button key={m.name} type="button" className={`nl-food-chip ${sel(on)}`} style={{ '--c': m.color }}
                    onClick={() => patch({ foods: on ? form.foods.filter(x => x !== m.name) : [...form.foods, m.name] })}>
                    <Icon name={m.icon} />{m.name}
                  </button>
                );
              })}
            </div>
            <span className="nl-small">Freshly prepared by By US  · we&apos;ll call to confirm food payment</span>
          </div>

          {/* 06 pass */}
          <div className="nl-step">
            <span className="nl-step__label" style={{ color: C.violet }}>06 · HAVE A GAMING PASS?</span>
            <div className="nl-yesno">
              <button type="button" className={sel(form.hasPass)} onClick={() => patch({ hasPass: true })}>YES</button>
              <button type="button" className={sel(!form.hasPass)} onClick={() => patch({ hasPass: false })}>CONTINUE AS GUEST</button>
            </div>
            {form.hasPass && (
              <>
                <div className="nl-fields nl-fields--sm">
                  <label className="nl-field">PASS ID
                    <input className="nl-input nl-input--upper" value={form.passId} onChange={e => patch({ passId: e.target.value })} type="text" placeholder="e.g. NL-P-1234" maxLength={32} />
                  </label>
                  <label className="nl-field">LAST 4 DIGITS OF PASS PHONE
                    <input className="nl-input" value={form.passLast4} onChange={e => patch({ passLast4: e.target.value.replace(/\D/g, '').slice(0, 4) })} type="text" inputMode="numeric" maxLength={4} placeholder="0000" />
                  </label>
                </div>
                <span className="nl-small">Your pass hours are verified at check-in. New here? <a href="#passes">Buy a pass →</a></span>
              </>
            )}
          </div>
        </div>

        {/* summary */}
        <div className="nl-summary">
          <div><span className="nl-summary__eyebrow">BOOKING SUMMARY</span><h3>INSTANT MANIFEST</h3></div>
          <div className="nl-manifest">
            <div><span>ROOM:</span><b>{room.name} · {form.players}P</b></div>
            <div><span>WHEN:</span><span className="is-when">{form.start == null ? 'Pick a slot' : `${dNice(date)} · ${hLabel(form.start)} (${form.dur}h)`}</span></div>
            <div><span>RATE:</span><span>{inr(p.rate)}/hr</span></div>
            <div className="is-muted"><span>GAMING:</span><span>{form.hasPass ? 'Pass' : inr(p.gaming)}</span></div>
            {p.disc > 0 && <div className="is-promo"><span>PROMO:</span><span>-{inr(p.disc)}</span></div>}
            {form.hasPass && <div className="is-pass"><span>GAMING PASS:</span><span>Hours at check-in</span></div>}
            {form.foods.length > 0 && <div className="is-food"><span>FOOD:</span><span>Confirmed by call</span></div>}
            <div className="nl-manifest__total"><span>TOTAL DUE:</span><span>{inr(p.total)}</span></div>
          </div>
          <div className="nl-promo">PROMO CODE
            <div className="nl-promo__row">
              <input className="nl-input" value={form.promoInput} onChange={e => patch({ promoInput: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && onApplyPromo()} type="text" placeholder="WARP15" maxLength={32} aria-label="Promo code" />
              <button type="button" onClick={onApplyPromo} disabled={promoBusy}>{promoBusy ? '…' : 'APPLY'}</button>
            </div>
            <span style={{ fontSize: 11, color: form.promo ? C.emerald : C.crimson }}>{form.promoMsg}</span>
          </div>
          {error && <div className="nl-error" role="alert">{error}</div>}
          {notice && <div className="nl-notice">{notice}</div>}
          <button type="button" className="nl-confirm" onClick={onConfirm} disabled={submitting}>
            {submitting ? 'LOCKING YOUR SLOT…' : '🚀 CONFIRM BOOKING'}
          </button>
          <div className="nl-paynote">
            {user ? 'PAY AT THE LOUNGE · UPI & CASH AT DESK' : 'YOU’LL SIGN IN TO CONFIRM · PAY AT THE LOUNGE'}
          </div>
        </div>
      </div>
    </section>
  );
});

export default Booking;
