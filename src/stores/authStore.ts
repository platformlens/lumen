import { create } from 'zustand';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { lumenLogAuth as authLog, lumenShortId as shortUserId } from '../lib/lumen-logger';

/** Must be listed under Supabase Auth → URL Configuration → Redirect URLs (custom scheme handled by Electron). */
export const LUMEN_SUPABASE_OAUTH_REDIRECT =
  typeof import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT === 'string' &&
  import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT.trim().length > 0
    ? import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT.trim()
    : 'io.platformlens.lumen://auth/callback';

let githubOAuthIpcCleanup: (() => void) | null = null;

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
  /** Set after email/password sign-up when Supabase returns no session until email is confirmed. */
  pendingVerificationEmail: string | null;
}

interface AuthActions {
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGithub: () => Promise<void>;
  signOut: () => Promise<void>;
  initialize: () => void;
  fetchProfile: () => Promise<void>;
  clearError: () => void;
  clearPendingVerificationEmail: () => void;
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

const DUPLICATE_EMAIL_SIGNUP_MESSAGE =
  'An account with this email already exists. Sign in instead.';

/** GoTrue may return a fake user with no identities when signup targets an existing confirmed account (obfuscated response). */
export function isDuplicateSignupObfuscatedUser(user: User | null | undefined): boolean {
  if (!user) return false;
  return Array.isArray(user.identities) && user.identities.length === 0;
}

function isDuplicateSignupError(error: { code?: string; message?: string; status?: number }): boolean {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  if (code === 'email_exists' || code === 'user_already_exists' || code === 'identity_already_exists' || code === 'conflict') {
    return true;
  }
  const msg = (error.message ?? '').toLowerCase();
  return (
    msg.includes('already registered') ||
    msg.includes('already been registered') ||
    msg.includes('user already registered') ||
    (msg.includes('email') && msg.includes('already')) ||
    msg.includes('already exists') ||
    msg.includes('duplicate') ||
    error.status === 422
  );
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
  pendingVerificationEmail: null,

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
        if (isDuplicateSignupError(error)) {
          set({ error: DUPLICATE_EMAIL_SIGNUP_MESSAGE, isLoading: false });
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

      if (isDuplicateSignupObfuscatedUser(data.user)) {
        authLog('signUp: duplicate email (obfuscated user, empty identities)');
        set({ error: DUPLICATE_EMAIL_SIGNUP_MESSAGE, isLoading: false });
        return;
      }

      if (!data.user) {
        set({ error: 'Could not create an account. Try again or sign in if you already registered.', isLoading: false });
        return;
      }

      if (!data.session) {
        const verifyEmail = (data.user.email ?? email).trim();
        authLog('signUp: email confirmation required, pending verification UI', {
          email: verifyEmail.includes('@') ? `${verifyEmail.split('@')[0].slice(0, 2)}…@${verifyEmail.split('@')[1]}` : '(redacted)',
        });
        set({
          user: null,
          session: null,
          profile: null,
          pendingVerificationEmail: verifyEmail,
          isLoading: false,
          error: null,
          isProfileLoading: false,
        });
        return;
      }

      set({
        user: data.user,
        session: data.session,
      });

      await get().fetchProfile();

      {
        const orgUid = data.session.user.id;
        authLog('signUp: scheduling org rehydrate (setTimeout 0)', { userId: shortUserId(orgUid) });
        setTimeout(() => {
          void import('./orgStore').then(({ useOrgStore }) => {
            void useOrgStore.getState().rehydrateSessionOrgData(orgUid);
          });
        }, 0);
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
        pendingVerificationEmail: null,
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

  signInWithGithub: async () => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return;
    }

    const client = supabase;

    const k8s = typeof window !== 'undefined' ? (window as unknown as { k8s?: { auth?: { onOAuthCallback?: (fn: (url: string) => void) => () => void }; openExternal?: (url: string) => Promise<void> } }).k8s : undefined;
    const onOAuth = k8s?.auth?.onOAuthCallback;
    if (!onOAuth || !k8s?.openExternal) {
      set({ error: 'GitHub sign-in is only available in the Lumen desktop app.' });
      return;
    }

    githubOAuthIpcCleanup?.();
    githubOAuthIpcCleanup = null;

    set({ isLoading: true, error: null });
    authLog('signInWithGithub: starting OAuth');

    let settled = false;
    const oauthTimeoutMs = 120_000;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      githubOAuthIpcCleanup?.();
      githubOAuthIpcCleanup = null;
      settled = true;
      set({ error: 'GitHub sign-in timed out. Try again.', isLoading: false });
      authLog('signInWithGithub: timeout');
    }, oauthTimeoutMs);

    const finish = () => {
      if (!settled) settled = true;
      window.clearTimeout(timeoutId);
    };

    githubOAuthIpcCleanup = onOAuth(async (callbackUrl: string) => {
      githubOAuthIpcCleanup?.();
      githubOAuthIpcCleanup = null;
      finish();

      authLog('signInWithGithub: received redirect');
      try {
        let parsed: URL;
        try {
          parsed = new URL(callbackUrl);
        } catch {
          set({ error: 'Invalid sign-in redirect. Try again.', isLoading: false });
          return;
        }

        const authErr =
          parsed.searchParams.get('error_description')?.replace(/\+/g, ' ') ||
          parsed.searchParams.get('error');
        if (authErr) {
          set({ error: authErr, isLoading: false });
          return;
        }

        const code = parsed.searchParams.get('code');
        if (!code) {
          set({ error: 'Missing authorization code after GitHub. Try again.', isLoading: false });
          return;
        }

        const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          authLog('signInWithGithub: exchange failed', { message: exchangeError.message });
          set({ error: exchangeError.message, isLoading: false });
          return;
        }

        authLog('signInWithGithub: exchange ok');
        await get().fetchProfile();
        set({ isLoading: false });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'GitHub sign-in failed.';
        set({ error: msg, isLoading: false });
      }
    });

    try {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: LUMEN_SUPABASE_OAUTH_REDIRECT,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        githubOAuthIpcCleanup?.();
        githubOAuthIpcCleanup = null;
        finish();
        authLog('signInWithGithub: signInWithOAuth error', { message: error.message });
        set({ error: error.message, isLoading: false });
        return;
      }

      if (!data.url) {
        githubOAuthIpcCleanup?.();
        githubOAuthIpcCleanup = null;
        finish();
        set({ error: 'Could not start GitHub sign-in.', isLoading: false });
        return;
      }

      await k8s.openExternal(data.url);
    } catch (err: unknown) {
      githubOAuthIpcCleanup?.();
      githubOAuthIpcCleanup = null;
      finish();
      const msg = err instanceof Error ? err.message : 'GitHub sign-in failed.';
      set({ error: msg, isLoading: false });
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
      pendingVerificationEmail: null,
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
          set({ user: session.user, session, isLoading: false, pendingVerificationEmail: null });
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
          set({
            user: null,
            session: null,
            profile: null,
            isLoading: false,
            isProfileLoading: false,
            pendingVerificationEmail: null,
          });
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
          set({
            user: data.session.user,
            session: data.session,
            isLoading: false,
            pendingVerificationEmail: null,
          });
          await get().fetchProfile();
          authLog('initialize: profile loaded, running org rehydrate');
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          const { useOrgStore } = await import('./orgStore');
          await useOrgStore.getState().rehydrateSessionOrgData(data.session.user.id);
          authLog('initialize: org rehydrate finished');
        } else {
          authLog('initialize: no session in storage (signed out or first launch)');
          set({
            user: null,
            session: null,
            profile: null,
            isLoading: false,
            isProfileLoading: false,
            pendingVerificationEmail: null,
          });
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

    const { user, session } = get();
    if (!user) {
      authLog('fetchProfile: skip — no user in store');
      return;
    }
    if (!session) {
      authLog('fetchProfile: skip — no session (e.g. email not confirmed)');
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

  clearPendingVerificationEmail: () => {
    set({ pendingVerificationEmail: null });
  },
}));
