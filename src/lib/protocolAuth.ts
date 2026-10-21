import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Protocol workspaces deliberately use their own browser session.  A person
// can therefore sign in/out here without changing the finance application.
export const protocolAuth = createClient(url, key, {
  auth: {
    storage: localStorage,
    // A versioned, protocol-only key deliberately prevents inheriting an
    // already-open finance-app session from an earlier version.
    storageKey: 'church-account-protocol-auth-v2',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
