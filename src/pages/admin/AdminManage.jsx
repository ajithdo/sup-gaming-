import { useCallback, useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import { useAuth } from '../../auth/AuthProvider';
import {
  adminCreateCoupon, adminCreatePass, adminFetchCoupons, adminFetchPasses, adminFetchProfiles,
  adminSetUserRole, adminUpdateCoupon, adminUpdatePass, adminUpdateRoom, fetchRooms,
} from '../../lib/api';
import { addDays, todayKey } from '../../lib/time';
import { C } from '../../config/site';

function useLoad(fn) {
  const [data, setData] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try { setData(await fn()); setError(''); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [fn]);
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, error, setError, loading, reload };
}

const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// ------------------------------------------------------------------ users --
export function UsersTab() {
  const { user } = useAuth();
  const { data: users, setData, error, setError, loading } = useLoad(adminFetchProfiles);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [ok, setOk] = useState('');

  const list = users.filter(u => !q.trim() || [u.email, u.full_name, u.phone].some(v => v?.toLowerCase().includes(q.trim().toLowerCase())));
  const admins = users.filter(u => u.role === 'admin').length;

  async function setRole(u, role) {
    if (role === u.role) return;
    const verb = role === 'admin' ? 'Give ADMIN access to' : 'Remove admin access from';
    if (!window.confirm(`${verb} ${u.email}?`)) return;
    setBusy(u.id); setOk(''); setError('');
    try {
      const updated = await adminSetUserRole(u.id, role);
      setData(list => list.map(x => (x.id === updated.id ? { ...x, role: updated.role } : x)));
      setOk(`${u.email} is now ${role.toUpperCase()}.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  return (
    <>
      <div>
        <h1 className="ad-h">USERS &amp; ROLES</h1>
        <p className="ad-sub">{users.length} accounts · {admins} admin{admins === 1 ? '' : 's'}. Admins can open this dashboard and manage every booking. You can’t change your own role.</p>
      </div>
      <input className="ad-input" placeholder="Search email, name or phone" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 420 }} />
      {error && <div className="ad-error">{error}</div>}
      {ok && <div className="ad-ok">{ok}</div>}
      <div className="ad-card"><div className="ad-tablewrap">
        <table className="ad-table">
          <thead><tr><th>USER</th><th>PHONE</th><th>JOINED</th><th>ROLE</th></tr></thead>
          <tbody>
            {list.map(u => (
              <tr key={u.id}>
                <td><div className="ad-strong">{u.full_name || '—'}</div><div className="ad-muted">{u.email}</div></td>
                <td>{u.phone || '—'}</td>
                <td>{fmtDate(u.created_at)}</td>
                <td>
                  <select className="ad-select" value={u.role} disabled={u.id === user?.id || busy === u.id}
                    title={u.id === user?.id ? 'Ask another admin to change your role' : ''} onChange={e => setRole(u, e.target.value)}>
                    <option value="customer">Customer</option>
                    <option value="admin">Admin</option>
                  </select>
                  {u.id === user?.id && <span className="ad-small"> (you)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>{loading && <div className="ad-empty">Loading…</div>}</div>
    </>
  );
}

// ---------------------------------------------------------------- coupons --
export function CouponsTab() {
  const { data: coupons, setData, error, setError, loading } = useLoad(adminFetchCoupons);
  const [f, setF] = useState({ code: '', percent_off: 10, max_uses: '', valid_until: '', description: '' });

  async function create(e) {
    e.preventDefault(); setError('');
    try {
      const row = await adminCreateCoupon({
        code: f.code.trim().toUpperCase(), percent_off: Number(f.percent_off), description: f.description.trim() || null,
        max_uses: f.max_uses ? Number(f.max_uses) : null,
        valid_until: f.valid_until ? new Date(f.valid_until + 'T23:59:59+05:30').toISOString() : null,
      });
      setData(list => [row, ...list]);
      setF({ code: '', percent_off: 10, max_uses: '', valid_until: '', description: '' });
    } catch (err) { setError(err.message); }
  }

  async function toggle(c) {
    try { const row = await adminUpdateCoupon(c.code, { active: !c.active }); setData(list => list.map(x => (x.code === c.code ? row : x))); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      <div>
        <h1 className="ad-h">PROMO CODES</h1>
        <p className="ad-sub">Codes are checked and applied by the database at booking time. Promo codes don’t apply to pass bookings.</p>
      </div>
      {error && <div className="ad-error">{error}</div>}
      <div className="ad-card">
        <form className="ad-form" onSubmit={create}>
          <label>CODE<input className="ad-input" required pattern="[A-Za-z0-9_\-]{3,32}" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="DIWALI20" /></label>
          <label>% OFF<input className="ad-input" required type="number" min="1" max="100" value={f.percent_off} onChange={e => setF({ ...f, percent_off: e.target.value })} /></label>
          <label>MAX USES<input className="ad-input" type="number" min="1" value={f.max_uses} onChange={e => setF({ ...f, max_uses: e.target.value })} placeholder="unlimited" /></label>
          <label>VALID UNTIL<input className="ad-input" type="date" value={f.valid_until} onChange={e => setF({ ...f, valid_until: e.target.value })} /></label>
          <label>NOTE<input className="ad-input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="optional" /></label>
          <button type="submit" className="ad-btn ad-btn--solid" style={{ '--c': C.emerald, height: 38 }}><Icon name="add" />ADD CODE</button>
        </form>
        <div className="ad-tablewrap">
          <table className="ad-table">
            <thead><tr><th>CODE</th><th className="num">% OFF</th><th className="num">USED</th><th>VALID UNTIL</th><th>NOTE</th><th>STATUS</th></tr></thead>
            <tbody>
              {coupons.map(c => (
                <tr key={c.code}>
                  <td className="ad-code">{c.code}</td>
                  <td className="num">{c.percent_off}%</td>
                  <td className="num">{c.uses}{c.max_uses ? ' / ' + c.max_uses : ''}</td>
                  <td>{fmtDate(c.valid_until)}</td>
                  <td className="ad-muted">{c.description || '—'}</td>
                  <td>
                    <button type="button" className="ad-btn" style={{ '--c': c.active ? C.emerald : '#64748b' }} onClick={() => toggle(c)}>
                      <Icon name={c.active ? 'toggle_on' : 'toggle_off'} />{c.active ? 'ACTIVE' : 'OFF'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <div className="ad-empty">Loading…</div>}
      </div>
    </>
  );
}

// ----------------------------------------------------------------- passes --
const blankPass = () => ({ code: '', kind: 'private', holder_name: '', holder_phone: '', hours_total: 10, valid_until: addDays(todayKey(), 30), notes: '' });

export function PassesTab() {
  const { data: passes, setData, error, setError, loading } = useLoad(adminFetchPasses);
  const [f, setF] = useState(blankPass);

  async function create(e) {
    e.preventDefault(); setError('');
    try {
      const phone = f.holder_phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
      const row = await adminCreatePass({
        code: f.code.trim().toUpperCase(), kind: f.kind, holder_name: f.holder_name.trim(), holder_phone: phone,
        hours_total: Number(f.hours_total), valid_until: f.valid_until, notes: f.notes.trim() || null,
      });
      setData(list => [row, ...list]);
      setF(blankPass());
    } catch (err) { setError(err.message); }
  }

  async function update(p, patch) {
    try { const row = await adminUpdatePass(p.id, patch); setData(list => list.map(x => (x.id === p.id ? row : x))); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      <div>
        <h1 className="ad-h">GAMING PASSES</h1>
        <p className="ad-sub">Customers enter the pass ID + last 4 digits of this phone when booking. Hours are deducted at check-in.</p>
      </div>
      {error && <div className="ad-error">{error}</div>}
      <div className="ad-card">
        <form className="ad-form" onSubmit={create}>
          <label>PASS ID<input className="ad-input" required pattern="[A-Za-z0-9\-]{3,32}" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} placeholder="NL-P-1001" /></label>
          <label>TYPE
            <select className="ad-select" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
              <option value="private">Private room</option><option value="racing">Racing sim</option><option value="open">Open gaming</option>
            </select>
          </label>
          <label>HOLDER<input className="ad-input" required value={f.holder_name} onChange={e => setF({ ...f, holder_name: e.target.value })} /></label>
          <label>PHONE<input className="ad-input" required value={f.holder_phone} onChange={e => setF({ ...f, holder_phone: e.target.value })} placeholder="10 digits" /></label>
          <label>HOURS<input className="ad-input" required type="number" min="1" step="0.5" value={f.hours_total} onChange={e => setF({ ...f, hours_total: e.target.value })} /></label>
          <label>VALID UNTIL<input className="ad-input" required type="date" value={f.valid_until} onChange={e => setF({ ...f, valid_until: e.target.value })} /></label>
          <button type="submit" className="ad-btn ad-btn--solid" style={{ '--c': C.violet, height: 38 }}><Icon name="add" />ISSUE PASS</button>
        </form>
        <div className="ad-tablewrap">
          <table className="ad-table">
            <thead><tr><th>PASS</th><th>HOLDER</th><th className="num">HOURS LEFT</th><th>VALID UNTIL</th><th>ACTIONS</th></tr></thead>
            <tbody>
              {passes.map(p => {
                const left = Number(p.hours_total) - Number(p.hours_used);
                const expired = p.valid_until < todayKey();
                return (
                  <tr key={p.id}>
                    <td><div className="ad-code">{p.code}</div><div className="ad-muted">{p.kind.toUpperCase()}</div></td>
                    <td><div className="ad-strong">{p.holder_name}</div><div className="ad-muted">{p.holder_phone}</div></td>
                    <td className="num"><span className="ad-strong">{left}</span> <span className="ad-muted">/ {Number(p.hours_total)}</span></td>
                    <td style={{ color: expired ? C.crimson : undefined }}>{p.valid_until}{expired ? ' (expired)' : ''}</td>
                    <td>
                      <div className="ad-actions">
                        <button type="button" className="ad-btn" style={{ '--c': C.cyan }} onClick={() => {
                          const add = Number(window.prompt('Add how many hours?', '5'));
                          if (add > 0) update(p, { hours_total: Number(p.hours_total) + add });
                        }}><Icon name="more_time" />ADD HOURS</button>
                        <button type="button" className="ad-btn" style={{ '--c': p.active ? C.emerald : '#64748b' }} onClick={() => update(p, { active: !p.active })}>
                          <Icon name={p.active ? 'toggle_on' : 'toggle_off'} />{p.active ? 'ACTIVE' : 'OFF'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && passes.length === 0 && <div className="ad-empty">No passes issued yet.</div>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ rooms --
export function RoomsTab() {
  const { data: rooms, setData, error, setError } = useLoad(fetchRooms);
  const [drafts, setDrafts] = useState({});
  const [ok, setOk] = useState('');

  const draft = r => drafts[r.id] || { state: r.state, rates: r.rates.join(', ') };

  async function save(r) {
    const d = draft(r);
    const rates = d.rates.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
    if (!rates.length) { setError('Enter at least one hourly rate.'); return; }
    setError(''); setOk('');
    try {
      const row = await adminUpdateRoom(r.id, { state: d.state, rates });
      setData(list => list.map(x => (x.id === r.id ? row : x)));
      setDrafts(({ [r.id]: _, ...rest }) => rest);
      setOk(`${row.name} saved.`);
    } catch (e) { setError(e.message); }
  }

  return (
    <>
      <div>
        <h1 className="ad-h">ROOMS &amp; PRICES</h1>
        <p className="ad-sub">Rates are per hour by number of players (1st = solo, 2nd = duo …). Prices are charged by the database, so changes apply to new bookings immediately.</p>
      </div>
      {error && <div className="ad-error">{error}</div>}
      {ok && <div className="ad-ok">{ok}</div>}
      <div className="ad-card"><div className="ad-tablewrap">
        <table className="ad-table">
          <thead><tr><th>ROOM</th><th>ONLINE BOOKING</th><th>RATES (₹/HR BY PLAYERS)</th><th /></tr></thead>
          <tbody>
            {rooms.map(r => {
              const d = draft(r);
              return (
                <tr key={r.id}>
                  <td><div className="ad-strong">{r.name}</div><div className="ad-muted">{r.subtitle}</div></td>
                  <td>
                    <select className="ad-select" value={d.state} onChange={e => setDrafts({ ...drafts, [r.id]: { ...d, state: e.target.value } })}>
                      <option value="book">Bookable</option><option value="soon">Coming soon</option><option value="walkin">Walk-in only</option>
                    </select>
                  </td>
                  <td><input className="ad-input" value={d.rates} onChange={e => setDrafts({ ...drafts, [r.id]: { ...d, rates: e.target.value } })} /></td>
                  <td><button type="button" className="ad-btn ad-btn--solid" disabled={!drafts[r.id]} onClick={() => save(r)}><Icon name="save" />SAVE</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div></div>
    </>
  );
}
