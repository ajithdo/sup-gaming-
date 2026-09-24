import { useState } from 'react';
import { supabase } from '../lib/supabase';

function friendlyAuthError(error) {
  const m = error?.message || '';
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first — check your inbox for the link.';
  if (/already registered|already been registered/i.test(m)) return 'An account with this email already exists — sign in instead.';
  if (/password should be at least|weak password/i.test(m)) return 'Choose a stronger password (at least 8 characters).';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
  if (/failed to fetch|network/i.test(m)) return 'Can’t reach the server. Check your connection.';
  return m || 'Something went wrong. Please try again.';
}

/**
 * Email + password sign in / sign up / password reset (Supabase Auth).
 * New accounts are always created as "customer"; only an admin can grant "admin".
 */
export default function AuthForm({ initialMode = 'signin', defaults = {}, onSignedIn, title, subtitle }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(defaults.email || '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(defaults.name || '');
  const [phone, setPhone] = useState(defaults.phone || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  if (!supabase) {
    return <div className="nl-error">Sign-in isn’t configured yet. Add your Supabase URL and key to <code>.env.local</code>.</div>;
  }

  const switchTo = m => { setMode(m); setError(''); setInfo(''); };

  async function signInWithGoogle() {
    setError(''); setInfo(''); setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin }
      });
      if (err) throw err;
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'signin') {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
        onSignedIn?.(data.session);
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Password should be at least 8 characters.');
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            // Only harmless profile fields go in metadata — the role is set by the database.
            data: { full_name: fullName.trim(), phone: phone.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (err) throw err;
        if (data.session) onSignedIn?.(data.session);
        else { setInfo('Account created! Check your email to confirm it, then sign in here.'); setMode('signin'); setPassword(''); }
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin + '/reset-password',
        });
        if (err) throw err;
        setInfo('If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <h2>{title || (mode === 'signup' ? 'CREATE ACCOUNT' : mode === 'forgot' ? 'RESET PASSWORD' : 'SIGN IN')}</h2>
        {subtitle && <p className="nl-auth__sub" style={{ marginTop: 6 }}>{subtitle}</p>}
      </div>
      {mode !== 'forgot' && (
        <div className="nl-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'is-on' : ''} onClick={() => switchTo('signin')}>SIGN IN</button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-on' : ''} onClick={() => switchTo('signup')}>NEW ACCOUNT</button>
        </div>
      )}
      <form onSubmit={submit} noValidate={false}>
        {mode === 'signup' && (
          <>
            <label className="nl-field">NAME
              <input className="nl-input" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" required maxLength={80} placeholder="Your name" />
            </label>
            <label className="nl-field">PHONE (OPTIONAL)
              <input className="nl-input" value={phone} onChange={e => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" maxLength={16} placeholder="10-digit mobile" />
            </label>
          </>
        )}
        <label className="nl-field">EMAIL
          <input className="nl-input" value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required placeholder="you@example.com" />
        </label>
        {mode !== 'forgot' && (
          <label className="nl-field">PASSWORD
            <input className="nl-input" value={password} onChange={e => setPassword(e.target.value)} type="password" required minLength={mode === 'signup' ? 8 : undefined}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'} />
          </label>
        )}
        {error && <div className="nl-error" role="alert">{error}</div>}
        {info && <div className="nl-success" role="status">{info}</div>}
        <button type="submit" className="nl-confirm" disabled={busy}>
          {busy ? 'PLEASE WAIT…' : mode === 'signup' ? 'CREATE ACCOUNT' : mode === 'forgot' ? 'SEND RESET LINK' : 'SIGN IN'}
        </button>
        <div className="nl-auth__row">
          {mode === 'signin' && <button type="button" className="nl-textbtn" onClick={() => switchTo('forgot')}>Forgot password?</button>}
          {mode === 'forgot' && <button type="button" className="nl-textbtn" onClick={() => switchTo('signin')}>← Back to sign in</button>}
        </div>
        {mode !== 'forgot' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0 10px', color: 'var(--t4)', fontSize: '12px', letterSpacing: '.1em' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--b2)' }} />
              <span style={{ margin: '0 10px' }}>OR</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--b2)' }} />
            </div>
            <button
              type="button"
              className="nl-confirm"
              onClick={signInWithGoogle}
              disabled={busy}
              style={{
                background: 'transparent',
                border: '1px solid var(--b2)',
                color: '#fff',
                boxShadow: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                marginTop: '10px'
              }}
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" style={{ width: 18, height: 18 }} />
              CONTINUE WITH GOOGLE
            </button>
          </>
        )}
      </form>
    </>
  );
}
