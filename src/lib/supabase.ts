import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;

const ipcStorage = {
  getItem: async (_key: string): Promise<string | null> => {
    try {
      const session = await (window as any).k8s.auth.getSession();
      return typeof session === 'string' ? session : (session ? JSON.stringify(session) : null);
    } catch (e) {
      console.error('Error getting session from IPC:', e);
      return null;
    }
  },
  setItem: async (_key: string, value: string): Promise<void> => {
    try {
      await (window as any).k8s.auth.saveSession(value);
    } catch (e) {
      console.error('Error saving session via IPC:', e);
    }
  },
  removeItem: async (_key: string): Promise<void> => {
    try {
      await (window as any).k8s.auth.clearSession();
    } catch (e) {
      console.error('Error clearing session via IPC:', e);
    }
  }
};

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  );
} else {
  const isLumenRenderer =
    typeof window !== 'undefined' && (window as { k8s?: unknown }).k8s != null;

  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: ipcStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // Electron: single window — skip Navigator/Web Locks. Combined with not awaiting
      // supabase.data calls inside onAuthStateChange, avoids getSession/REST deadlocks
      // where the network panel shows no request until a client-side timeout.
      ...(isLumenRenderer
        ? {
            lock: <R,>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) => fn(),
          }
        : {}),
    },
  });
}

export { supabase };
