import { create } from 'zustand';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { lumenLogAuth as authLog, lumenShortId as shortUserId } from '../lib/lumen-logger';

/** Unsubscribe for the single Supabase auth listener (avoids duplicate handlers if initialize runs more than once). */
let supabaseAuthUnsubscribe: (() => void) | null = null;

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
  /** True after first getSession() hydration (or when Supabase is disabled). */
  authHydrated: boolean;
  /** True while the profiles table row is being fetched. */
  isProfileLoading: boolean;
  error: string | null;
}

interface AuthActions {
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  initialize: () => void;
  fetchProfile: () => Promise<void>;
  clearError: () => void;
}

type AuthStore = AuthState & AuthActions;

const NOT_CONFIGURED_ERROR =
  'Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.';

/** Confirmed-email links from Supabase redirect here; must be listed under Auth → URL Configuration → Redirect URLs. */
const SIGNUP_EMAIL_REDIRECT_TO = 'https://www.platformlens.io';

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
  authHydrated: false,
  isProfileLoading: false,
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
          emailRedirectTo: SIGNUP_EMAIL_REDIRECT_TO,
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

      set({
        user: data.user,
        session: data.session,
      });

      // Fetch profile created by the database trigger
      await get().fetchProfile();

      if (data.session) {
        const orgUid = data.session.user.id;
        authLog('signUp: scheduling org rehydrate (setTimeout 0)', { userId: shortUserId(orgUid) });
        setTimeout(() => {
          void import('./orgStore').then(({ useOrgStore }) => {
            void useOrgStore.getState().rehydrateSessionOrgData(orgUid);
          });
        }, 0);
      } else {
        authLog('signUp: no session in response (e.g. email confirm required) — org rehydrate skipped');
      }

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
    authLog('signIn: attempt', { email: email.trim() });

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        authLog('signIn: failed', { message: error.message });
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
      authLog('signIn: success', { userId: shortUserId(data.user.id) });

      // Fetch profile after successful sign-in
      await get().fetchProfile();
      // Org rehydration runs from `onAuthStateChange` (SIGNED_IN), deferred with setTimeout(0) so
      // it does not block inside the auth mutex (avoids org isLoading stuck / deadlock).

      set({ isLoading: false });
    } catch (err: any) {
      authLog('signIn: exception', { message: err?.message });
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
    authLog('signOut: start');

    try {
      if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.error('Supabase signOut error:', error);
          authLog('signOut: supabase error', { message: error.message });
          set({ error: 'Failed to sign out. Please try again.' });
        } else {
          authLog('signOut: supabase ok');
        }
      }
    } catch (err) {
      console.error('signOut exception:', err);
      set({ error: 'Failed to sign out. Please try again.' });
    }

    set({
      user: null,
      profile: null,
      session: null,
      isLoading: false,
      isProfileLoading: false,
    });
    authLog('signOut: local state cleared');
  },

  initialize: () => {
    if (!supabase) {
      authLog('initialize: supabase not configured, skipping auth');
      set({ authHydrated: true });
      return;
    }

    // One subscription — onAuthStateChange can fire in any order relative to an explicit getSession();
    if (!supabaseAuthUnsubscribe) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        authLog('onAuthStateChange', {
          event,
          hasSession: Boolean(session),
          userId: shortUserId(session?.user?.id),
        });

        if (session) {
          const prev = get().user;
          if (prev?.id && prev.id !== session.user.id) {
            authLog('onAuthStateChange: user id changed, clearing profile', {
              from: shortUserId(prev.id),
              to: shortUserId(session.user.id),
            });
            set({ profile: null });
          }
          set({ user: session.user, session, isLoading: false });
          const prof = get().profile;
          const needs =
            !prof || prof.id !== session.user.id;
          // Do NOT await fetchProfile (or any supabase.data call) here. PostgREST uses
          // getAccessToken() → getSession(), which can block on the same auth Web Lock held
          // for this onAuthStateChange callback — REST never fires (no network row), 45s+ timeouts.
          if (needs) {
            authLog('onAuthStateChange: scheduling profile fetch (setTimeout 0, avoids auth lock)', {
              userId: shortUserId(session.user.id),
            });
            setTimeout(() => {
              void get().fetchProfile();
            }, 0);
          } else {
            authLog('onAuthStateChange: profile already matches user, skip fetch');
          }
          // Do NOT await org rehydrate here. Same lock issue as profile fetch; deferred above.
          if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
            const orgUid = session.user.id;
            authLog('onAuthStateChange: scheduling org rehydrate (setTimeout 0)', {
              event,
              userId: shortUserId(orgUid),
            });
            setTimeout(() => {
              void import('./orgStore').then(({ useOrgStore }) => {
                void useOrgStore.getState().rehydrateSessionOrgData(orgUid);
              });
            }, 0);
          } else {
            authLog('onAuthStateChange: org rehydrate not scheduled (event not INITIAL_SESSION / SIGNED_IN)', {
              event,
            });
          }
        } else {
          authLog('onAuthStateChange: session cleared');
          set({ user: null, session: null, profile: null, isLoading: false, isProfileLoading: false });
        }
      });
      supabaseAuthUnsubscribe = () => {
        data.subscription.unsubscribe();
        supabaseAuthUnsubscribe = null;
      };
    }

    // Cold start: explicitly restore from IPC-backed storage. Relying only on INITIAL_SESSION
    // can race the first render or miss profile fetch after a reload.
    void (async () => {
      authLog('initialize: cold-start getSession()…');
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.error('Supabase getSession on hydrate:', sessionError);
          authLog('initialize: getSession error', { message: sessionError.message });
          set({ authHydrated: true, isLoading: false });
          return;
        }
        if (data.session) {
          authLog('initialize: session restored from storage', {
            userId: shortUserId(data.session.user.id),
          });
          set({ user: data.session.user, session: data.session, isLoading: false });
          await get().fetchProfile();
          authLog('initialize: profile loaded, running org rehydrate');
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          const { useOrgStore } = await import('./orgStore');
          await useOrgStore.getState().rehydrateSessionOrgData(data.session.user.id);
          authLog('initialize: org rehydrate finished');
        } else {
          authLog('initialize: no session in storage (signed out or first launch)');
          set({ user: null, session: null, profile: null, isLoading: false, isProfileLoading: false });
        }
      } catch (e) {
        console.error('Auth hydrate error:', e);
        authLog('initialize: hydrate exception', { message: e instanceof Error ? e.message : String(e) });
        set({ isLoading: false });
      } finally {
        set({ authHydrated: true });
        authLog('initialize: authHydrated = true');
      }
    })();
  },

  fetchProfile: async () => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return;
    }

    const { user } = get();
    if (!user) {
      authLog('fetchProfile: skip — no user in store');
      return;
    }

    set({ isProfileLoading: true, error: null });
    authLog('fetchProfile: loading', { userId: shortUserId(user.id) });
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        authLog('fetchProfile: supabase error', { message: error.message, code: error.code });
        set({ error: 'Failed to load profile.' });
        return;
      }

      // Prefer DB email; fall back to auth user so UI is never empty after reload.
      const row = data as UserProfile;
      set({
        profile: {
          ...row,
          email: row.email || user.email || '',
        },
      });
      authLog('fetchProfile: ok', { fullName: row.full_name, hasEmail: Boolean(row.email || user.email) });
    } catch (err) {
      authLog('fetchProfile: exception', { message: err instanceof Error ? err.message : String(err) });
      set({ error: 'Failed to load profile.' });
    } finally {
      set({ isProfileLoading: false });
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
