import { create } from 'zustand';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { generateInviteCode } from '../utils/invite-code-utils';
import { lumenLogOrg as orgLog, lumenShortId as shortId } from '../lib/lumen-logger';
import { withTimeout } from '../lib/with-timeout';
import { useAuthStore } from './authStore';

// --- Interfaces ---

export interface Organization {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'super_admin' | 'admin' | 'member';
  joined_at: string;
  full_name?: string;
  email?: string;
}

export interface Team {
  id: string;
  organization_id: string;
  name: string;
  created_by: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  full_name?: string;
  email?: string;
}

interface OrgState {
  organizations: Organization[];
  activeOrganization: Organization | null;
  teams: Team[];
  orgMembers: OrganizationMember[];
  teamMembers: Record<string, TeamMember[]>;
  isLoading: boolean;
  error: string | null;
}

interface OrgActions {
  createOrganization: (name: string) => Promise<void>;
  createTeam: (name: string) => Promise<Team | null>;
  joinOrganizationByCode: (code: string) => Promise<{ type: 'org' | 'team'; name: string } | null>;
  joinTeamByCode: (code: string) => Promise<{ type: 'team'; name: string } | null>;
  joinByCode: (code: string) => Promise<{ type: 'org' | 'team'; name: string } | null>;
  /** Pass `userId` when known (e.g. from auth `session.user.id`) to avoid `getSession()` deadlocks inside `onAuthStateChange`. */
  fetchOrganizations: (userId?: string | null) => Promise<void>;
  /**
   * After session restore or login: load org list, re-select the last active org (or first),
   * and load teams + org members (via setActiveOrganization).
   * Pass `userId` from the auth session when available.
   */
  rehydrateSessionOrgData: (userId?: string | null) => Promise<void>;
  fetchTeams: (orgId: string) => Promise<void>;
  fetchOrgMembers: (orgId: string) => Promise<void>;
  fetchTeamMembers: (teamId: string) => Promise<void>;
  setActiveOrganization: (org: Organization | null) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

type OrgStore = OrgState & OrgActions;

const NOT_CONFIGURED_ERROR =
  'Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.';

/** Persisted in the renderer so the active org (and its teams) restore after app reload. */
const ACTIVE_ORG_STORAGE_KEY = 'lumen.activeOrganizationId';

/** Serialize concurrent/duplicate rehydration (auth hydrate + zustand subscribe on same session). */
let rehydrateSessionOrgDataInFlight: Promise<void> | null = null;

const INITIAL_STATE: OrgState = {
  organizations: [],
  activeOrganization: null,
  teams: [],
  orgMembers: [],
  teamMembers: {},
  isLoading: false,
  error: null,
};

/**
 * Resolves the user id for org RLS queries.
 * Prefer `override` (from `onAuthStateChange(_, session)` or cold-start `getSession`) so we
 * never call `getSession()` while the auth mutex is held (can deadlock / spin forever).
 */
async function resolveOrgUserId(overrideUserId?: string | null): Promise<string | null> {
  if (overrideUserId) {
    orgLog('resolveUserId: using explicit user id (from auth/caller)', { userId: shortId(overrideUserId) });
    return overrideUserId;
  }
  const fromStore = useAuthStore.getState().user?.id;
  if (fromStore) {
    orgLog('resolveUserId: from Zustand', { userId: shortId(fromStore) });
    return fromStore;
  }
  if (!supabase) {
    orgLog('resolveUserId: no supabase client');
    return null;
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const fromSession = session?.user?.id ?? null;
  orgLog('resolveUserId: from getSession()', {
    hasSession: Boolean(session),
    userId: shortId(fromSession),
  });
  return fromSession;
}

export const useOrgStore = create<OrgStore>((set, get) => ({
  // --- State ---
  ...INITIAL_STATE,

  // --- Actions ---

  createOrganization: async (name: string) => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return;
    }

    set({ isLoading: true, error: null });

    const user = useAuthStore.getState().user;
    if (!user) {
      orgLog('createOrganization: aborted — no user in Zustand');
      set({ isLoading: false, error: 'You must be signed in to create an organization.' });
      return;
    }

    // RLS: "Users can create orgs" WITH CHECK (auth.uid() = owner_id). PostgREST must send
    // a user access_token; if we fall back to the anon key, auth.uid() is null and RLS fails.
    let { data: sessionWrap } = await supabase.auth.getSession();
    let session = sessionWrap?.session;
    if (!session) {
      orgLog('createOrganization: getSession() empty — trying refreshSession');
      const { data: ref } = await supabase.auth.refreshSession();
      session = ref.session ?? null;
    }
    if (!session?.user?.id) {
      orgLog('createOrganization: no session JWT — RLS will reject (auth.uid() null)');
      set({
        isLoading: false,
        error:
          'Your session is not available. Please sign in again, then try creating the organization.',
      });
      return;
    }
    const ownerId = session.user.id;
    if (user.id !== ownerId) {
      orgLog('createOrganization: zustand user id differs from session; using session', {
        zustand: shortId(user.id),
        session: shortId(ownerId),
      });
    }

    orgLog('createOrganization: start', {
      name: name.trim(),
      ownerId: shortId(ownerId),
      hasAccessToken: Boolean(session.access_token),
    });
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const inviteCode = generateInviteCode();
      orgLog('createOrganization: insert attempt', { attempt: attempt + 1, maxRetries });

      // DB has trigger handle_new_organization() which inserts owner as super_admin into
      // organization_members (required for RLS is_org_member() on read).
      const insertStarted = performance.now();
      let created: Organization | null = null;
      let error: { code?: string; message?: string } | null = null;
      try {
        const res = await withTimeout(
          supabase
            .from('organizations')
            .insert({
              name,
              owner_id: ownerId,
              invite_code: inviteCode,
            })
            .select('id, name, owner_id, invite_code, created_at, updated_at')
            .single(),
          45_000,
          'Create organization (save to server)'
        );
        created = (res.data as Organization | null) ?? null;
        error = res.error;
      } catch (e) {
        const elapsedMs = Math.round(performance.now() - insertStarted);
        const msg = e instanceof Error ? e.message : String(e);
        orgLog('createOrganization: insert did not complete', {
          message: msg,
          attempt: attempt + 1,
          elapsedMs,
        });
        set({
          isLoading: false,
          error: msg.includes('timed out')
            ? 'Creating the organization is taking too long. Check your connection and try again.'
            : msg || 'Failed to create organization.',
        });
        return;
      }

      orgLog('createOrganization: insert response', {
        attempt: attempt + 1,
        elapsedMs: Math.round(performance.now() - insertStarted),
        hasError: Boolean(error),
        hasData: Boolean(created),
        code: error?.code,
        message: error?.message,
      });

      if (!error && created) {
        const org = created;
        orgLog('createOrganization: row inserted', { orgId: shortId(org.id), name: org.name });
        try {
          await withTimeout(
            (async () => {
              orgLog('createOrganization: post-insert → fetchOrganizations', { userId: shortId(ownerId) });
              await get().fetchOrganizations(ownerId);
              orgLog('createOrganization: post-insert → setActiveOrganization', { orgId: shortId(org.id) });
              await get().setActiveOrganization(org);
            })(),
            60_000,
            'Load organizations after create'
          );
          set({ error: null });
          orgLog('createOrganization: done — list refreshed and org activated', { orgId: shortId(org.id) });
        } catch (e) {
          console.error('createOrganization post-insert:', e);
          set({
            error:
              e instanceof Error
                ? e.message.includes('timed out')
                  ? 'Loading your new organization is taking too long. Try refreshing, or check your connection.'
                  : e.message
                : 'Organization created but failed to load details.',
          });
        } finally {
          set({ isLoading: false });
        }
        return;
      }

      // Check for unique constraint violation (invite code collision)
      if (error?.code === '23505' && attempt < maxRetries - 1) {
        continue;
      }

      if (error?.code === '23505') {
        set({ isLoading: false, error: 'Failed to generate unique invite code.' });
        return;
      }

      orgLog('createOrganization: insert failed', {
        code: error?.code,
        message: error?.message,
        attempt: attempt + 1,
      });
      console.error('createOrganization error:', error);
      set({
        isLoading: false,
        error: error?.message || 'Failed to create organization. Please try again.',
      });
      return;
    }
  },

  createTeam: async (name: string) => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return null;
    }

    set({ isLoading: true, error: null });

    const user = useAuthStore.getState().user;
    const activeOrg = get().activeOrganization;

    if (!user) {
      set({ isLoading: false, error: 'You must be signed in to create a team.' });
      return null;
    }

    if (!activeOrg) {
      set({ isLoading: false, error: 'No active organization selected.' });
      return null;
    }

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const inviteCode = generateInviteCode();

      const { data: inserted, error } = await supabase
        .from('teams')
        .insert({
          name,
          organization_id: activeOrg.id,
          created_by: user.id,
          invite_code: inviteCode,
        })
        .select('id, organization_id, name, created_by, invite_code, created_at, updated_at')
        .single();

      if (!error && inserted) {
        const team = inserted as Team;
        await get().fetchTeams(activeOrg.id);
        await get().fetchTeamMembers(team.id);
        set({ isLoading: false, error: null });
        return team;
      }

      // Check for unique constraint violation (invite code collision)
      if (error?.code === '23505' && attempt < maxRetries - 1) {
        continue;
      }

      if (error?.code === '23505') {
        set({ isLoading: false, error: 'Failed to generate unique invite code.' });
        return null;
      }

      set({ isLoading: false, error: error?.message || 'Failed to create team. Please try again.' });
      return null;
    }

    return null;
  },

  joinOrganizationByCode: async (code: string) => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return null;
    }

    set({ isLoading: true, error: null });

    const user = useAuthStore.getState().user;
    if (!user) {
      set({ isLoading: false, error: 'You must be signed in to join an organization.' });
      return null;
    }

    // Look up org by invite code
    const { data: org, error: lookupError } = await supabase
      .from('organizations')
      .select('*')
      .eq('invite_code', code)
      .maybeSingle();

    if (lookupError) {
      set({ isLoading: false, error: 'Failed to look up invite code. Please try again.' });
      return null;
    }

    if (!org) {
      // No org match — return null so joinByCode can try teams
      set({ isLoading: false });
      return null;
    }

    // Check for existing membership
    const { data: existingMember } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', org.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingMember) {
      set({ isLoading: false, error: 'You are already a member of this organization.' });
      return null;
    }

    // Insert membership
    const { error: joinError } = await supabase
      .from('organization_members')
      .insert({
        organization_id: org.id,
        user_id: user.id,
        role: 'member',
      });

    if (joinError) {
      set({ isLoading: false, error: 'Failed to join organization. Please try again.' });
      return null;
    }

    // Add the org to the list directly
    const currentOrgs = get().organizations;
    if (!currentOrgs.find((o) => o.id === org.id)) {
      set({ organizations: [...currentOrgs, org as Organization] });
    }
    set({ isLoading: false });
    return { type: 'org' as const, name: org.name };
  },

  joinTeamByCode: async (code: string) => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return null;
    }

    set({ isLoading: true, error: null });

    const user = useAuthStore.getState().user;
    if (!user) {
      set({ isLoading: false, error: 'You must be signed in to join a team.' });
      return null;
    }

    // Look up team by invite code
    const { data: team, error: lookupError } = await supabase
      .from('teams')
      .select('*')
      .eq('invite_code', code)
      .maybeSingle();

    if (lookupError) {
      set({ isLoading: false, error: 'Failed to look up invite code. Please try again.' });
      return null;
    }

    if (!team) {
      set({ isLoading: false, error: 'Invalid invite code. Please check and try again.' });
      return null;
    }

    // Verify user is an org member of the parent org
    const { data: orgMembership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', team.organization_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!orgMembership) {
      set({ isLoading: false, error: 'You must join the organization first before joining this team.' });
      return null;
    }

    // Check for existing team membership
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', team.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingMember) {
      set({ isLoading: false, error: 'You are already a member of this team.' });
      return null;
    }

    // Insert team membership
    const { error: joinError } = await supabase
      .from('team_members')
      .insert({
        team_id: team.id,
        user_id: user.id,
        role: 'member',
      });

    if (joinError) {
      set({ isLoading: false, error: 'Failed to join team. Please try again.' });
      return null;
    }

    set({ isLoading: false });
    return { type: 'team' as const, name: team.name };
  },

  joinByCode: async (code: string) => {
    // Try org first
    const orgResult = await get().joinOrganizationByCode(code);
    if (orgResult) {
      return orgResult;
    }

    // If no org match and no error was set (meaning org just wasn't found),
    // try team
    const currentError = get().error;
    if (!currentError) {
      const teamResult = await get().joinTeamByCode(code);
      return teamResult;
    }

    // If an error was set (e.g., already a member), don't try teams
    return null;
  },

  fetchOrganizations: async (userIdParam?: string | null) => {
    if (!supabase) {
      orgLog('fetchOrganizations: no supabase client');
      return;
    }

    orgLog('fetchOrganizations: start', { userIdParam: userIdParam ? shortId(userIdParam) : '(resolve)' });
    const userId = await resolveOrgUserId(userIdParam);
    if (!userId) {
      orgLog('fetchOrganizations: abort — no user id');
      return;
    }

    // Two-step load: avoid relying on a nested `organizations` embed, which can come back
    // under a different key or as an array depending on PostgREST FK hints — that produced
    // empty `organizations` in the UI even when `organization_members` had rows.
    const { data: memRows, error: memError } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);

    if (memError) {
      orgLog('fetchOrganizations: organization_members query failed', {
        message: memError.message,
        code: memError.code,
      });
      console.warn('fetchOrganizations (members) error:', memError.message);
      set({ organizations: [], error: 'Could not load your organizations.' });
      return;
    }

    if (!memRows || memRows.length === 0) {
      orgLog('fetchOrganizations: no membership rows for user', { userId: shortId(userId) });
      set({ organizations: [], error: null });
      return;
    }

    const orgIds = [...new Set(memRows.map((m: { organization_id: string }) => m.organization_id))];

    const { data: orgRows, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, owner_id, invite_code, created_at, updated_at')
      .in('id', orgIds);

    if (orgError) {
      orgLog('fetchOrganizations: organizations query failed', {
        message: orgError.message,
        code: orgError.code,
        orgIdCount: orgIds.length,
      });
      console.warn('fetchOrganizations (organizations) error:', orgError.message);
      set({ organizations: [], error: 'Could not load organization details.' });
      return;
    }

    const byId = new Map((orgRows || []).map((o) => [o.id, o as Organization]));
    // Stable order: first occurrence in membership rows, then id
    const ordered: Organization[] = [];
    const seen = new Set<string>();
    for (const id of orgIds) {
      const o = byId.get(id);
      if (o && !seen.has(o.id)) {
        seen.add(o.id);
        ordered.push(o);
      }
    }

    orgLog('fetchOrganizations: success', {
      userId: shortId(userId),
      memberRowCount: memRows.length,
      orgCount: ordered.length,
      orgNames: ordered.map((o) => o.name),
    });
    set({ organizations: ordered, error: null });
  },

  rehydrateSessionOrgData: async (userIdFromAuth?: string | null) => {
    if (!supabase) {
      orgLog('rehydrateSessionOrgData: no supabase client');
      return;
    }

    orgLog('rehydrateSessionOrgData: called', {
      fromAuth: userIdFromAuth ? shortId(userIdFromAuth) : '(none)',
    });
    const userId = await resolveOrgUserId(userIdFromAuth);
    if (!userId) {
      orgLog('rehydrateSessionOrgData: abort — no user id after resolve');
      return;
    }

    if (rehydrateSessionOrgDataInFlight) {
      orgLog('rehydrateSessionOrgData: waiting for in-flight rehydration');
      return rehydrateSessionOrgDataInFlight;
    }

    rehydrateSessionOrgDataInFlight = (async () => {
      orgLog('rehydrateSessionOrgData: in-flight start', { userId: shortId(userId) });
      set({ isLoading: true, error: null });
      try {
        await get().fetchOrganizations(userId);
        const orgs = get().organizations;
        if (orgs.length === 0) {
          orgLog('rehydrateSessionOrgData: no orgs — clearing active org');
          await get().setActiveOrganization(null);
          return;
        }

        let storedId: string | null = null;
        try {
          storedId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        const fromStorage = storedId ? orgs.find((o) => o.id === storedId) : null;
        const next = fromStorage ?? orgs[0];
        orgLog('rehydrateSessionOrgData: selecting active org', {
          fromLocalStorage: Boolean(fromStorage),
          activeOrgId: shortId(next.id),
          activeName: next.name,
        });
        await get().setActiveOrganization(next);
      } catch (e) {
        console.error('rehydrateSessionOrgData:', e);
        orgLog('rehydrateSessionOrgData: error', { message: e instanceof Error ? e.message : String(e) });
        set({
          error: e instanceof Error ? e.message : 'Failed to load organizations.',
        });
      } finally {
        set({ isLoading: false });
        orgLog('rehydrateSessionOrgData: in-flight end (isLoading → false)');
      }
    })();

    try {
      await rehydrateSessionOrgDataInFlight;
    } finally {
      rehydrateSessionOrgDataInFlight = null;
    }
  },

  fetchTeams: async (orgId: string) => {
    if (!supabase) {
      return;
    }

    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('organization_id', orgId);

    if (error) {
      console.warn('fetchTeams error:', error.message);
      set({ teams: [] });
      return;
    }

    set({ teams: data || [] });
  },

  fetchOrgMembers: async (orgId: string) => {
    if (!supabase) {
      return;
    }

    const { data, error } = await supabase
      .from('organization_members')
      .select(`
        id,
        organization_id,
        user_id,
        role,
        joined_at,
        profiles (
          full_name,
          email
        )
      `)
      .eq('organization_id', orgId);

    if (error) {
      console.warn('fetchOrgMembers error:', error.message);
      set({ orgMembers: [] });
      return;
    }

    const orgMembers: OrganizationMember[] = (data || []).map((row: any) => ({
      id: row.id,
      organization_id: row.organization_id,
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
      full_name: row.profiles?.full_name,
      email: row.profiles?.email,
    }));

    set({ orgMembers });
  },

  fetchTeamMembers: async (teamId: string) => {
    if (!supabase) {
      return;
    }

    const { data, error } = await supabase
      .from('team_members')
      .select(`
        id,
        team_id,
        user_id,
        role,
        joined_at,
        profiles (
          full_name,
          email
        )
      `)
      .eq('team_id', teamId);

    if (error) {
      console.warn('fetchTeamMembers error:', error.message);
      set({
        teamMembers: { ...get().teamMembers, [teamId]: [] },
      });
      return;
    }

    const members: TeamMember[] = (data || []).map((row: any) => ({
      id: row.id,
      team_id: row.team_id,
      user_id: row.user_id,
      role: row.role,
      joined_at: row.joined_at,
      full_name: row.profiles?.full_name,
      email: row.profiles?.email,
    }));

    set({
      teamMembers: { ...get().teamMembers, [teamId]: members },
    });
  },

  setActiveOrganization: async (org: Organization | null) => {
    orgLog('setActiveOrganization', {
      orgId: org ? shortId(org.id) : null,
      name: org?.name ?? null,
    });
    set({ activeOrganization: org });
    try {
      if (org) {
        localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, org.id);
      } else {
        localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('setActiveOrganization: could not persist org id', e);
    }

    if (org) {
      await get().fetchTeams(org.id);
      orgLog('setActiveOrganization: teams loaded', { count: get().teams.length });
      await get().fetchOrgMembers(org.id);
      orgLog('setActiveOrganization: org members loaded', { count: get().orgMembers.length });
    } else {
      set({ teams: [], orgMembers: [], teamMembers: {} });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    orgLog('reset: clearing org/team state (sign-out)');
    set({ ...INITIAL_STATE });
    try {
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
}));

// Clear org state on sign-out. Org/team reload is handled by auth `getSession` IIFE and
// `onAuthStateChange` (INITIAL_SESSION / SIGNED_IN) so it runs after profile + JWT are ready.
let previousUser: User | null = null;

useAuthStore.subscribe((state) => {
  const currentUser = state.user;
  if (previousUser && !currentUser) {
    orgLog('auth user became null — resetting org store');
    useOrgStore.getState().reset();
  }
  previousUser = currentUser;
});
