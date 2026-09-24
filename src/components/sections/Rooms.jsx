import { useRef, useState } from 'react';
import Icon from '../Icon';
import { C } from '../../config/site';
import { HOURS, hLabel, hShort, inr, isPast } from '../../lib/time';

function roomStatus(room, open, busy) {
  if (room.state === 'soon') return { label: 'Coming Soon', color: C.violet };
  if (room.state === 'walkin') return { label: 'Walk-In Only', color: C.amber };
  if (!open) return { label: 'Opens 12 PM', color: C.amber };
  if (busy) return { label: 'In Session', color: C.amber };
  return { label: 'Available Now', color: C.emerald };
}

/** Room photo, falling back to the room icon if the image can't load. */
function RoomMedia({ room }) {
  const [broken, setBroken] = useState(false);
  if (!room.img || broken) return <Icon name={room.icon} />;
  return <img alt={room.name} src={room.img} loading="lazy" onError={() => setBroken(true)} />;
}

export function Rooms({ rooms, open, today, nowHour, taken, onPickRoom }) {
  const track = useRef(null);
  const scroll = dx => track.current?.scrollBy({ left: dx, behavior: 'smooth' });

  return (
    <section id="rooms" className="nl-section" data-screen-label="03 Rooms">
      <div className="nl-sechead">
        <div>
          <div className="nl-eyebrow"><span className="nl-eyebrow__dot" />OUR ROOMS</div>
          <h2 className="nl-h2">CHOOSE YOUR SETUP</h2>
        </div>
        <div className="nl-arrows">
          <button type="button" className="nl-arrow" aria-label="Previous" onClick={() => scroll(-320)}>←</button>
          <button type="button" className="nl-arrow" aria-label="Next" onClick={() => scroll(320)}>→</button>
        </div>
      </div>
      <div ref={track} className="nl-carousel">
        {rooms.map(r => {
          const can = r.state === 'book';
          const busy = can && open && taken(r.id, today, nowHour);
          const st = roomStatus(r, open, busy);
          return (
            <div key={r.id} className="nl-roomcard" style={{ '--c': r.color }}>
              <div className="nl-roomcard__media">
                <RoomMedia room={r} />
                <span className="nl-chip" style={{ '--sc': st.color }}>{st.label}</span>
              </div>
              <h3>{r.name}</h3>
              <p>{r.subtitle}</p>
              <div className="nl-roomcard__foot">
                <div>
                  <span className="nl-roomcard__price">{inr(r.rates[0] ?? 0)}</span>
                  <span className="nl-roomcard__unit">{r.unit}</span>
                </div>
                <button type="button" className="nl-roomcard__btn" disabled={!can} onClick={e => can && onPickRoom(r.id, e)}>
                  {can ? 'BOOK →' : r.state === 'soon' ? 'SOON' : 'WALK IN'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function LiveStatus({ rooms, open, today, todayLabel, nowHour, now, taken, onPickCell }) {
  const bookable = rooms.filter(r => r.state === 'book');
  return (
    <section id="live" className="nl-section" data-screen-label="05 Live Status">
      <div className="nl-sechead" style={{ marginBottom: 28 }}>
        <div>
          <div className="nl-live__live">LIVE RADAR // {todayLabel}</div>
          <h2 className="nl-h2">ROOM AVAILABILITY TODAY</h2>
        </div>
        <div className="nl-legend">
          <span style={{ color: C.emerald }}><i style={{ background: C.emerald }} />OPEN</span>
          <span style={{ color: C.crimson }}><i style={{ background: C.crimson }} />BOOKED</span>
          <span style={{ color: '#64748b' }}><i style={{ background: '#334155' }} />PAST</span>
        </div>
      </div>
      <div className="nl-live">
        {bookable.map(r => {
          const busyNow = open && taken(r.id, today, nowHour);
          const nextFree = HOURS.find(h => !isPast(today, h, now) && !taken(r.id, today, h));
          const label = !open ? 'CLOSED · OPENS 12 PM'
            : busyNow ? (nextFree != null ? 'IN SESSION · FREE FROM ' + hLabel(nextFree) : 'FULLY BOOKED TODAY')
            : '● AVAILABLE NOW';
          return (
            <div key={r.id} className="nl-live__row">
              <div className="nl-live__head">
                <strong>{r.name}</strong>
                <span style={{ color: !open || busyNow ? C.amber : C.emerald }}>{label}</span>
              </div>
              <div className="nl-live__cells">
                {HOURS.map(h => {
                  const past = isPast(today, h, now);
                  const tk = taken(r.id, today, h);
                  const ok = !past && !tk;
                  return (
                    <button key={h} type="button" title={hLabel(h)} disabled={!ok}
                      className={`nl-cell ${past ? 'is-past' : tk ? 'is-booked' : ''}`}
                      onClick={e => ok && onPickCell(r.id, today, h, e)}>
                      {hShort(h)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="nl-live__note">Tap an open hour to start a booking. Open 12 PM – 11 PM, Monday to Sunday.</div>
      </div>
    </section>
  );
}
