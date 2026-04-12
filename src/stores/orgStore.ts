import { create } from 'zustand';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { generateInviteCode } from '../utils/invite-code-utils';
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
  createTeam: (name: string) => Promise<void>;
  joinOrganizationByCode: (code: string) => Promise<{ type: 'org' | 'team'; name: string } | null>;
  joinTeamByCode: (code: string) => Promise<{ type: 'team'; name: string } | null>;
  joinByCode: (code: string) => Promise<{ type: 'org' | 'team'; name: string } | null>;
  fetchOrganizations: () => Promise<void>;
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

const INITIAL_STATE: OrgState = {
  organizations: [],
  activeOrganization: null,
  teams: [],
  orgMembers: [],
  teamMembers: {},
  isLoading: false,
  error: null,
};

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
      set({ isLoading: false, error: 'You must be signed in to create an organization.' });
      return;
    }

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const inviteCode = generateInviteCode();

      const { error } = await supabase
        .from('organizations')
        .insert({
          name,
          owner_id: user.id,
          invite_code: inviteCode,
        });

      if (!error) {
        await get().fetchOrganizations();
        const orgs = get().organizations;
        const createdOrg = orgs.find((o) => o.invite_code === inviteCode) || null;
        if (createdOrg) {
          await get().setActiveOrganization(createdOrg);
        }
        set({ isLoading: false });
        return;
      }

      // Check for unique constraint violation (invite code collision)
      if (error.code === '23505' && attempt < maxRetries - 1) {
        continue;
      }

      if (error.code === '23505') {
        set({ isLoading: false, error: 'Failed to generate unique invite code.' });
        return;
      }

      set({ isLoading: false, error: 'Failed to create organization. Please try again.' });
      return;
    }
  },

  createTeam: async (name: string) => {
    if (!supabase) {
      set({ error: NOT_CONFIGURED_ERROR });
      return;
    }

    set({ isLoading: true, error: null });

    const user = useAuthStore.getState().user;
    const activeOrg = get().activeOrganization;

    if (!user) {
      set({ isLoading: false, error: 'You must be signed in to create a team.' });
      return;
    }

    if (!activeOrg) {
      set({ isLoading: false, error: 'No active organization selected.' });
      return;
    }

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const inviteCode = generateInviteCode();

      const { error } = await supabase
        .from('teams')
        .insert({
          name,
          organization_id: activeOrg.id,
          created_by: user.id,
          invite_code: inviteCode,
        });

      if (!error) {
        await get().fetchTeams(activeOrg.id);
        set({ isLoading: false });
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

      set({ isLoading: false, error: 'Failed to create team. Please try again.' });
      return;
    }
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

  fetchOrganizations: async () => {
    if (!supabase) {
      return;
    }

    const user = useAuthStore.getState().user;
    if (!user) {
      return;
    }

    const { data, error } = await supabase
      .from('organization_members')
      .select(`
        organization_id,
        role,
        organizations (
          id,
          name,
          owner_id,
          invite_code,
          created_at,
          updated_at
        )
      `)
      .eq('user_id', user.id);

    if (error) {
      console.warn('fetchOrganizations error:', error.message);
      set({ organizations: [] });
      return;
    }

    const organizations: Organization[] = (data || [])
      .map((row: any) => row.organizations)
      .filter(Boolean);

    set({ organizations });
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
    set({ activeOrganization: org });

    if (org) {
      await get().fetchTeams(org.id);
      await get().fetchOrgMembers(org.id);
    } else {
      set({ teams: [], orgMembers: [], teamMembers: {} });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set({ ...INITIAL_STATE });
  },
}));

// Subscribe to auth state changes
let previousUser: User | null = null;

useAuthStore.subscribe((state) => {
  const currentUser = state.user;

  if (!previousUser && currentUser) {
    // User logged in or session restored — fetch organizations
    useOrgStore.getState().fetchOrganizations();
  } else if (previousUser && !currentUser) {
    // User logged out — reset org state
    useOrgStore.getState().reset();
  }

  previousUser = currentUser;
});
