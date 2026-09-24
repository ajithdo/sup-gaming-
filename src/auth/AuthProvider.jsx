import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

/**
 * Holds the Supabase session and the user's profile (including their role).
 *
 * The role here only drives the UI (which buttons and routes render). The real
 * protection is in the database: RLS policies and is_admin() checks mean a
 * customer can't read or change admin data even with a hand-crafted request.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(!supabase);
  // Which user the loaded profile belongs to — lets us tell "still loading" apart
  // from "loaded, and this user has no admin role" without a flash in between.
  const [loaded, setLoaded] = useState({ userId: null, profile: null });

  // 1. Session: initial value + live updates (sign in, sign out, token refresh)
  useEffect(() => {
    if (!supabase) return undefined;
    let live = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      // Don't call other Supabase methods inside this callback (supabase-js can
      // deadlock); the profile loads in the effect below instead.
      setSession(next);
      setSessionReady(true);
    });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, []);

  const userId = session?.user?.id ?? null;

  // 2. Profile (and therefore role) for the signed-in user
  const loadProfile = useCallback(async () => {
    if (!supabase || !userId) { setLoaded({ userId: null, profile: null }); return; }
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,full_name,phone,role')
      .eq('id', userId)
      .maybeSingle();
    if (error) console.warn('profile:', error.message);
    setLoaded({ userId, profile: data ?? null });
  }, [userId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // 3. If an admin changes this user's role, pick it up when they return to the tab.
  useEffect(() => {
    if (!supabase || !userId) return undefined;
    const onVisible = () => document.visibilityState === 'visible' && loadProfile();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [userId, loadProfile]);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setLoaded({ userId: null, profile: null });
  }, []);

  const value = useMemo(() => {
    const profile = loaded.userId === userId ? loaded.profile : null;
    const role = profile?.role ?? null;
    return {
      configured: Boolean(supabase),
      loading: !sessionReady || (userId !== null && loaded.userId !== userId),
      session,
      user: session?.user ?? null,
      profile,
      role,
      isAdmin: role === 'admin',
      hasRole: r => role === r,
      refreshProfile: loadProfile,
      signOut,
    };
  }, [session, userId, loaded, sessionReady, loadProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
