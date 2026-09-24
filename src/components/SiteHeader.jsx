import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { useAuth } from '../auth/AuthProvider';

const NAV = [
  ['#rooms', 'ROOMS'], ['#games', 'GAMES'], ['#live', 'LIVE STATUS'], ['#passes', 'PASSES'],
  ['#food', 'FOOD'], ['#my-bookings', 'MY BOOKINGS'], ['#contact', 'CONTACT'],
];

/** Admin-only link. Returns nothing at all for everyone else. */
function AdminButton({ className, children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return null;
  return <Link to="/admin" className={className} aria-label="Admin dashboard" title="Admin dashboard">{children}</Link>;
}

function AccountMenu({ onSignIn }) {
  const { user, profile, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  // Always visible when signed out (if Supabase isn't configured yet, the
  // sign-in dialog explains what's missing instead of the button vanishing).
  if (!user) {
    return (
      <button type="button" className="nl-signin" onClick={onSignIn} aria-label="Sign in or create an account">
        <Icon name="login" /><span className="nl-signin__label">SIGN IN</span>
      </button>
    );
  }

  const name = profile?.full_name || user.email;
  return (
    <div className="nl-account" ref={ref}>
      <button type="button" className="nl-iconbtn nl-iconbtn--account is-signed-in" aria-haspopup="menu" aria-expanded={open}
        aria-label="Account" title={name} onClick={() => setOpen(o => !o)}>
        <Icon name="account_circle" />
      </button>
      {open && (
        <div className="nl-account__menu" role="menu">
          <div className="nl-account__who">
            <strong>{name}</strong>
            {profile?.full_name && <span>{user.email}</span>}
            <span className={`nl-role ${isAdmin ? 'nl-role--admin' : ''}`}>{isAdmin ? 'ADMIN' : 'MEMBER'}</span>
          </div>
          <a href="#my-bookings" role="menuitem" onClick={() => setOpen(false)}><Icon name="confirmation_number" />My bookings</a>
          {isAdmin && (
            <Link to="/admin" role="menuitem" className="is-admin"><Icon name="admin_panel_settings" />Admin dashboard</Link>
          )}
          <button type="button" role="menuitem" onClick={async () => { setOpen(false); await signOut(); navigate('/'); }}>
            <Icon name="logout" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function SiteHeader({ live, onBook, onSignIn }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, isAdmin, signOut } = useAuth();
  const close = () => setMenuOpen(false);

  return (
    <header className="nl-header">
      <div className="nl-header__bar">
        <a href="#top" className="nl-header__logo"><img alt="NEXT LEVEL Gaming Zone" src="/assets/new_logo.png" width="78" height="52" /></a>
        <nav className="nl-nav" aria-label="Sections">
          {NAV.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <div className="nl-header__right">
          <div className="nl-livepill" style={{ '--live': live.color, '--live-border': live.color + '4d' }}>
            <span className="nl-ping" style={{ '--ping': live.color }} />
            <span>{live.pill}</span>
          </div>
          <AdminButton className="nl-admin-btn">
            <Icon name="admin_panel_settings" /><span className="nl-admin-btn__label">ADMIN</span>
          </AdminButton>
          <AccountMenu onSignIn={onSignIn} />
          <button type="button" className="nl-iconbtn nl-menu-btn" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
            <Icon name={menuOpen ? 'close' : 'menu'} />
          </button>
          <a href="#booking" className="nl-booknow" onClick={e => { close(); onBook(e); }}>
            <Icon name="rocket_launch" /><span>BOOK NOW</span>
          </a>
        </div>
      </div>
      {menuOpen && (
        <nav className="nl-mobile-nav" aria-label="Menu">
          {NAV.map(([href, label]) => <a key={href} href={href} onClick={close}>{label}</a>)}
          {isAdmin && (
            <Link to="/admin" className="is-admin" onClick={close}><Icon name="admin_panel_settings" />ADMIN DASHBOARD</Link>
          )}
          {user
            ? <button type="button" onClick={() => { close(); signOut(); }}><Icon name="logout" />SIGN OUT</button>
            : <button type="button" onClick={() => { close(); onSignIn(); }}><Icon name="login" />SIGN IN / CREATE ACCOUNT</button>}
        </nav>
      )}
    </header>
  );
}
