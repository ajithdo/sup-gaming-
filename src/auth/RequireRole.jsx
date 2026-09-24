import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import Icon from '../components/Icon';

/**
 * Route guard. Renders `children` only when the signed-in user has `role`.
 *   - still checking the session → loading screen (never flash protected content)
 *   - signed out                 → /login?next=<this page>
 *   - wrong role                 → "access denied" (the admin UI is never rendered)
 *
 * This is the UX layer. The database independently refuses admin reads/writes
 * for non-admins (RLS + is_admin()), so bypassing this component gains nothing.
 */
export default function RequireRole({ role, children }) {
  const { loading, user, role: current } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenMessage icon="progress_activity" spin title="CHECKING ACCESS…" />;

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (current !== role) {
    return (
      <FullScreenMessage icon="block" title="ACCESS DENIED" tone="crimson"
        text="This area is for NextLevel staff only.">
        <Link to="/" className="nl-btn nl-btn--ghost">BACK TO SITE</Link>
      </FullScreenMessage>
    );
  }

  return children;
}

export function FullScreenMessage({ icon, title, text, tone = 'cyan', spin = false, children }) {
  return (
    <div className="nl-fullscreen">
      <div className={`nl-fullscreen__card nl-tone-${tone}`}>
        <Icon name={icon} className={spin ? 'nl-spin' : ''} size={40} />
        <h1>{title}</h1>
        {text && <p>{text}</p>}
        {children}
      </div>
    </div>
  );
}
