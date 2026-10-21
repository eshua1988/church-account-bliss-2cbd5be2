import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Protocol workspaces deliberately use their own browser session.  A person
// can therefore sign in/out here without changing the finance application.
export const protocolAuth = createClient(url, key, {
  auth: {
    storage: localStorage,
    storageKey: 'church-account-protocol-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
