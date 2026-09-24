import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import AuthForm from '../auth/AuthForm';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import Icon from '../components/Icon';
import { FullScreenMessage } from '../auth/RequireRole';

/** Only allow same-site relative redirects (no open-redirects via ?next=). */
function safeNext(raw) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : '/';
}

function AuthShell({ children }) {
  return (
    <div className="nl-authpage">
      <div className="nl-authpage__bar">
        <Link to="/"><img alt="NEXT LEVEL Gaming Zone" src="/assets/new_logo.png" /></Link>
        <Link to="/"><Icon name="arrow_back" size={18} />BACK TO SITE</Link>
      </div>
      <div className="nl-authpage__body"><div className="nl-auth">{children}</div></div>
    </div>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (!loading && user) return <Navigate to={next} replace />;
  return (
    <AuthShell>
      <AuthForm
        initialMode={params.get('mode') === 'signup' ? 'signup' : 'signin'}
        subtitle={next.startsWith('/admin') ? 'Staff sign-in for the NextLevel admin dashboard.' : 'Book faster and see your bookings on any device.'}
        onSignedIn={() => navigate(next, { replace: true })}
      />
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waited, setWaited] = useState(false);

  // The recovery link signs the user in; give supabase-js a moment to read the URL.
  useEffect(() => { const t = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(t); }, []);

  if (loading || (!user && !waited)) return <FullScreenMessage icon="progress_activity" spin title="CHECKING LINK…" />;
  if (!user) {
    return (
      <FullScreenMessage icon="link_off" tone="crimson" title="LINK EXPIRED" text="That reset link is invalid or has expired. Request a new one.">
        <Link to="/login" className="nl-btn nl-btn--ghost">GO TO SIGN IN</Link>
      </FullScreenMessage>
    );
  }

  async function submit(e) {
    e.preventDefault();
    if (password.length < 8) { setError('Password should be at least 8 characters.'); return; }
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else navigate('/', { replace: true });
  }

  return (
    <AuthShell>
      <h1>NEW PASSWORD</h1>
      <p className="nl-auth__sub">Signed in as {user.email}. Choose a new password.</p>
      <form onSubmit={submit}>
        <label className="nl-field">NEW PASSWORD
          <input className="nl-input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {error && <div className="nl-error">{error}</div>}
        <button type="submit" className="nl-confirm" disabled={busy}>{busy ? 'SAVING…' : 'SAVE PASSWORD'}</button>
      </form>
    </AuthShell>
  );
}
