import { create } from 'zustand';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  isLoading: boolean;
  error: string | null;
}

interface AuthActions {
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  restoreSession: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  clearError: () => void;
}

type AuthStore = AuthState & AuthActions;

const NOT_CONFIGURED_ERROR =
  'Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.';

/**
 * Validates that a password meets the minimum length requirement.
 * @returns true if the password is at least 6 characters long.
 */
export function validatePassword(password: string): boolean {
  return password.length >= 6;
}

/**
 * Extracts uppercase initials from a full name.
 * Each whitespace-separated word contributes its first character.
 * Returns an empty string for empty input.
 */
export function getInitials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  // --- State ---
  user: null,
  profile: null,
  session: null,
  isLoading: false,
  error: null,

  // --- Actions ---

  signUp: async (email: string, password: string, fullName: string) => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (error) {
        if (error.message?.toLowerCase().includes('already registered') ||
            error.message?.toLowerCase().includes('already been registered') ||
            error.status === 422) {
          set({ error: 'An account with this email already exists.', isLoading: false });
        } else if (
          error.message?.toLowerCase().includes('fetch') ||
          error.message?.toLowerCase().includes('network') ||
          error.message?.toLowerCase().includes('unable to connect')
        ) {
          set({ error: 'Unable to connect. Please check your internet connection.', isLoading: false });
        } else {
          set({ error: error.message, isLoading: false });
        }
        return;
      }

      if (data.session) {
        try {
          await (window as any).k8s.auth.saveSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });
        } catch (e) {
          console.error('Failed to save session via IPC:', e);
        }
      }

      set({
        user: data.user,
        session: data.session,
      });

      // Fetch profile created by the database trigger
      await get().fetchProfile();

      set({ isLoading: false });
    } catch (err: any) {
      if (
        err?.message?.toLowerCase().includes('fetch') ||
        err?.message?.toLowerCase().includes('network')
      ) {
        set({ error: 'Unable to connect. Please check your internet connection.', isLoading: false });
      } else {
        set({ error: err?.message || 'An unexpected error occurred.', isLoading: false });
      }
    }
  },

  signIn: async (email: string, password: string) => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (error.message?.toLowerCase().includes('invalid') ||
            error.message?.toLowerCase().includes('credentials')) {
          set({ error: 'Invalid email or password.', isLoading: false });
        } else if (
          error.message?.toLowerCase().includes('fetch') ||
          error.message?.toLowerCase().includes('network') ||
          error.message?.toLowerCase().includes('unable to connect')
        ) {
          set({ error: 'Unable to connect. Please check your internet connection.', isLoading: false });
        } else {
          set({ error: error.message, isLoading: false });
        }
        return;
      }

      set({
        user: data.user,
        session: data.session,
      });

      if (data.session) {
        try {
          await (window as any).k8s.auth.saveSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });
        } catch (e) {
          console.error('Failed to save session via IPC:', e);
        }
      }

      // Fetch profile after successful sign-in
      await get().fetchProfile();

      set({ isLoading: false });
    } catch (err: any) {
      if (
        err?.message?.toLowerCase().includes('fetch') ||
        err?.message?.toLowerCase().includes('network')
      ) {
        set({ error: 'Unable to connect. Please check your internet connection.', isLoading: false });
      } else {
        set({ error: err?.message || 'An unexpected error occurred.', isLoading: false });
      }
    }
  },

  signOut: async () => {
    set({ isLoading: true, error: null });

    try {
      if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.error('Supabase signOut error:', error);
          set({ error: 'Failed to sign out. Please try again.' });
        }
      }
    } catch (err) {
      console.error('signOut exception:', err);
      set({ error: 'Failed to sign out. Please try again.' });
    }

    // Always clear local state and persisted session, even if signOut fails
    try {
      await (window as any).k8s.auth.clearSession();
    } catch (e) {
      console.error('Failed to clear session via IPC:', e);
    }

    set({
      user: null,
      profile: null,
      session: null,
      isLoading: false,
    });
  },

  restoreSession: async () => {
    if (!supabase) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const stored = await (window as any).k8s.auth.getSession();

      if (!stored) {
        set({ isLoading: false });
        return;
      }

      const { data, error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });

      if (error || !data.session) {
        // Session expired or invalid — clear stored session
        try {
          await (window as any).k8s.auth.clearSession();
        } catch (e) {
          console.error('Failed to clear expired session via IPC:', e);
        }
        set({ user: null, session: null, profile: null, isLoading: false });
        return;
      }

      // Session is valid — save potentially refreshed tokens
      try {
        await (window as any).k8s.auth.saveSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      } catch (e) {
        console.error('Failed to save refreshed session via IPC:', e);
      }

      set({
        user: data.user,
        session: data.session,
      });

      // Fetch profile for the restored user
      await get().fetchProfile();

      set({ isLoading: false });
    } catch (err: any) {
      // Treat IPC or network failures as no session
      try {
        await (window as any).k8s.auth.clearSession();
      } catch (_) {
        // ignore
      }
      set({ user: null, session: null, profile: null, isLoading: false });
    }
  },

  fetchProfile: async () => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return;
    }

    const { user } = get();
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        set({ error: 'Failed to load profile.' });
        return;
      }

      set({ profile: data as UserProfile });
    } catch (err) {
      set({ error: 'Failed to load profile.' });
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
