import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import { useAuth } from '../../auth/AuthProvider';
import { supabase } from '../../lib/supabase';
import { adminFetchBookings, adminSetBookingStatus } from '../../lib/api';
import { addDays, countdown, dNice, hLabel, inr, todayKey } from '../../lib/time';
import { useNow, useRooms } from '../../hooks/data';
import { C } from '../../config/site';
import { UsersTab, CouponsTab, PassesTab, RoomsTab } from './AdminManage';
import './admin.css';

export default function AdminDashboard() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="ad">
      <header className="ad-top">
        <div className="ad-top__bar">
          <Link to="/"><img alt="NEXT LEVEL" src="/assets/new_logo.png" /></Link>
          <div className="ad-top__title"><b>ADMIN DASHBOARD</b><span>NEXTLEVEL GAMING ZONE · STAFF ONLY</span></div>
          <span className="ad-top__who">{profile?.full_name || user?.email}</span>
          <Link to="/" className="ad-btn"><Icon name="storefront" />VIEW SITE</Link>
          <button type="button" className="ad-btn" style={{ '--c': C.crimson }} onClick={async () => { await signOut(); navigate('/'); }}>
            <Icon name="logout" />SIGN OUT
          </button>
        </div>
        <nav className="ad-tabs">
          <NavLink to="/admin" end><Icon name="event_note" />BOOKINGS</NavLink>
          <NavLink to="/admin/users"><Icon name="group" />USERS &amp; ROLES</NavLink>
          <NavLink to="/admin/coupons"><Icon name="sell" />PROMO CODES</NavLink>
          <NavLink to="/admin/passes"><Icon name="card_membership" />PASSES</NavLink>
          <NavLink to="/admin/rooms"><Icon name="meeting_room" />ROOMS</NavLink>
        </nav>
      </header>
      <main className="ad-body">
        <Routes>
          <Route index element={<BookingsTab />} />
          <Route path="users" element={<UsersTab />} />
          <Route path="coupons" element={<CouponsTab />} />
          <Route path="passes" element={<PassesTab />} />
          <Route path="rooms" element={<RoomsTab />} />
        </Routes>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
const STATUS_COLOR = {
  held: C.amber, confirmed: C.emerald, checked_in: C.cyan, completed: '#94a3b8',
  cancelled: C.crimson, expired: '#64748b', no_show: C.crimson,
};

function effectiveStatus(b, now) {
  if (b.status === 'held' && b.hold_expires_at && new Date(b.hold_expires_at).getTime() <= now) return 'expired';
  return b.status;
}

const ACTIONS = {
  held: [['confirmed', 'CONFIRM', C.emerald, true], ['cancelled', 'CANCEL', C.crimson]],
  expired: [['confirmed', 'RE-CONFIRM', C.emerald], ['cancelled', 'CANCEL', C.crimson]],
  confirmed: [['checked_in', 'CHECK IN', C.cyan, true], ['no_show', 'NO-SHOW', C.amber], ['cancelled', 'CANCEL', C.crimson]],
  checked_in: [['completed', 'COMPLETE', '#94a3b8', true]],
  cancelled: [['confirmed', 'RESTORE', C.emerald]],
  no_show: [['confirmed', 'RESTORE', C.emerald]],
  completed: [],
};

const RANGES = [['today', 'TODAY'], ['tomorrow', 'TOMORROW'], ['week', 'NEXT 7 DAYS'], ['past', 'LAST 30 DAYS']];
const FILTERS = [['all', 'ALL'], ['action', 'NEEDS ACTION'], ['active', 'ACTIVE'], ['closed', 'CLOSED']];

function useAdminBookings(from, to) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const load = useCallback(async () => {
    try { setRows(await adminFetchBookings({ from, to })); setError(''); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Live updates: RLS lets admins receive every booking change.
  useEffect(() => {
    if (!supabase) return undefined;
    const channel = supabase.channel('admin-bookings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        clearTimeout(timer.current);
        timer.current = setTimeout(load, 300);
      })
      .subscribe();
    const poll = setInterval(load, 60000);
    return () => { clearTimeout(timer.current); clearInterval(poll); supabase.removeChannel(channel); };
  }, [load]);

  return { rows, setRows, loading, error, reload: load };
}

function BookingsTab() {
  const now = useNow(1000);
  const rooms = useRooms();
  const today = todayKey(now);
  const [range, setRange] = useState('today');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState(null);

  const [from, to] = {
    today: [today, today], tomorrow: [addDays(today, 1), addDays(today, 1)],
    week: [today, addDays(today, 6)], past: [addDays(today, -30), addDays(today, -1)],
  }[range];
  // Always load today too, for the stat tiles.
  const { rows, setRows, loading, error, reload } = useAdminBookings(from < today ? from : today, to > today ? to : today);
  const roomName = id => rooms.find(r => r.id === id)?.name || id;

  const todays = rows.filter(b => b.booking_date === today);
  const live = s => !['cancelled', 'expired', 'no_show'].includes(s);
  const stats = {
    today: todays.filter(b => live(effectiveStatus(b, now))).length,
    waiting: rows.filter(b => b.booking_date >= today && effectiveStatus(b, now) === 'held').length,
    revenue: todays.filter(b => live(effectiveStatus(b, now))).reduce((s, b) => s + b.total_amount, 0),
    inside: todays.filter(b => b.status === 'checked_in').length,
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter(b => b.booking_date >= from && b.booking_date <= to)
      .filter(b => {
        const s = effectiveStatus(b, now);
        if (filter === 'action') return s === 'held' || (s === 'confirmed' && new Date(b.starts_at).getTime() <= now);
        if (filter === 'active') return ['held', 'confirmed', 'checked_in'].includes(s);
        if (filter === 'closed') return ['completed', 'cancelled', 'expired', 'no_show'].includes(s);
        return true;
      })
      .filter(b => !needle || [b.code, b.customer_name, b.customer_phone, b.customer_email].some(v => v?.toLowerCase().includes(needle)))
      .sort((a, b) => (range === 'past' ? b.starts_at.localeCompare(a.starts_at) : a.starts_at.localeCompare(b.starts_at)));
  }, [rows, from, to, filter, q, now, range]);

  async function act(b, status, label) {
    if (['cancelled', 'no_show'].includes(status) && !window.confirm(`${label} booking ${b.code}?`)) return;
    setBusyId(b.id); setFlash(null);
    try {
      const updated = await adminSetBookingStatus(b.id, status);
      setRows(rs => rs.map(x => (x.id === updated.id ? updated : x)));
      setFlash({ ok: true, text: `${b.code} → ${status.replace('_', ' ').toUpperCase()}` });
    } catch (e) {
      setFlash({ ok: false, text: `${b.code}: ${e.message}` });
      reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div>
        <h1 className="ad-h">BOOKINGS</h1>
        <p className="ad-sub">Confirm holds after the customer messages on WhatsApp, check people in, and keep the schedule clean. Updates live.</p>
      </div>
      <div className="ad-stats">
        <div className="ad-stat" style={{ '--c': C.cyan }}><span>TODAY&apos;S SESSIONS</span><b>{stats.today}</b></div>
        <div className="ad-stat" style={{ '--c': C.amber }}><span>AWAITING CONFIRMATION</span><b>{stats.waiting}</b></div>
        <div className="ad-stat" style={{ '--c': C.orange }}><span>EXPECTED TODAY</span><b>{inr(stats.revenue)}</b></div>
        <div className="ad-stat" style={{ '--c': C.emerald }}><span>CHECKED IN NOW</span><b>{stats.inside}</b></div>
      </div>
      <div className="ad-toolbar">
        <div className="ad-seg">{RANGES.map(([k, l]) => <button key={k} type="button" className={range === k ? 'is-on' : ''} onClick={() => setRange(k)}>{l}</button>)}</div>
        <div className="ad-seg">{FILTERS.map(([k, l]) => <button key={k} type="button" className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <input className="ad-input" style={{ flex: '1 1 220px' }} placeholder="Search code, name, phone, email" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {error && <div className="ad-error">{error}</div>}
      {flash && <div className={flash.ok ? 'ad-ok' : 'ad-error'}>{flash.text}</div>}
      <div className="ad-card">
        <div className="ad-tablewrap">
          <table className="ad-table">
            <thead>
              <tr><th>WHEN</th><th>ROOM</th><th>BOOKING</th><th>CUSTOMER</th><th className="num">AMOUNT</th><th>STATUS</th><th>ACTIONS</th></tr>
            </thead>
            <tbody>
              {list.map(b => {
                const s = effectiveStatus(b, now);
                const holdLeft = b.status === 'held' && b.hold_expires_at ? new Date(b.hold_expires_at).getTime() - now : null;
                return (
                  <tr key={b.id}>
                    <td>
                      <div className="ad-strong">{hLabel(b.start_hour)} · {b.duration_hours}h</div>
                      <div className="ad-muted">{dNice(b.booking_date)}</div>
                    </td>
                    <td><div className="ad-strong">{roomName(b.room_id)}</div><div className="ad-muted">{b.players} player{b.players > 1 ? 's' : ''}</div></td>
                    <td>
                      <div className="ad-code">{b.code}</div>
                      {b.foods?.length > 0 && <div className="ad-foods">🍔 {b.foods.join(', ')}</div>}
                      {b.game_request && <div className="ad-small">🎮 {b.game_request}</div>}
                      {b.admin_note && <div className="ad-small">📝 {b.admin_note}</div>}
                    </td>
                    <td>
                      <div className="ad-strong">{b.customer_name}</div>
                      <div><a href={`https://wa.me/91${b.customer_phone}`} target="_blank" rel="noopener noreferrer">{b.customer_phone}</a></div>
                      <div className="ad-muted">{b.customer_email}</div>
                    </td>
                    <td className="num">
                      {b.pass_code
                        ? <span style={{ color: C.violet }}>PASS {b.pass_code}</span>
                        : <><div className="ad-strong">{inr(b.total_amount)}</div>{b.discount_amount > 0 && <div className="ad-small">{b.coupon_code} −{inr(b.discount_amount)}</div>}</>}
                    </td>
                    <td>
                      <span className="ad-badge" style={{ '--c': STATUS_COLOR[s] }}>{s.replace('_', ' ').toUpperCase()}</span>
                      {holdLeft !== null && holdLeft > 0 && <div className="ad-small" style={{ marginTop: 4 }}>hold {countdown(holdLeft)}</div>}
                    </td>
                    <td>
                      <div className="ad-actions">
                        {(ACTIONS[s] || []).map(([to, label, color, solid]) => (
                          <button key={to} type="button" disabled={busyId === b.id} className={`ad-btn ${solid ? 'ad-btn--solid' : ''}`} style={{ '--c': color }} onClick={() => act(b, to, label)}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && list.length === 0 && <div className="ad-empty">No bookings match these filters.</div>}
        {loading && <div className="ad-empty">Loading…</div>}
      </div>
    </>
  );
}
