import { useEffect } from 'react';
import AuthForm from './AuthForm';
import Icon from '../components/Icon';

export default function AuthModal({ open, onClose, onSignedIn, subtitle, defaults }) {
  useEffect(() => {
    if (!open) return undefined;
    const esc = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="nl-modal" role="dialog" aria-modal="true" aria-label="Sign in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="nl-auth" style={{ textAlign: 'left' }}>
        <button type="button" className="nl-iconbtn nl-modal__close" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        <AuthForm subtitle={subtitle} defaults={defaults} onSignedIn={onSignedIn} />
      </div>
    </div>
  );
}
