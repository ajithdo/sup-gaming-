import { createClient } from '@supabase/supabase-js';

// This site's Supabase project. Both values are public by design (the publishable
// key only allows what Row Level Security permits), so they can live in the code.
// Environment variables, if set (Vercel settings or .env.local), take priority.
// NEVER put the secret / service_role key anywhere in this app.
const DEFAULT_URL = 'https://nxogbauuofkhkcyckwqn.supabase.co';
const DEFAULT_KEY = 'sb_publishable_Ioox-Mn5bN8Ar1SCt4COEg_WjJan7E8';

const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
// New projects use a "publishable" key; older ones call it the "anon" key. Either works.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_KEY;

export const supabaseConfigured = Boolean(url && key);

if (!supabaseConfigured && import.meta.env.DEV) {
  console.warn('[NextLevel] Supabase is not configured. Copy .env.example to .env.local and add your project URL + key.');
}

export const supabase = supabaseConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
