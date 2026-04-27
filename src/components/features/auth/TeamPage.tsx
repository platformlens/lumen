import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, UserPlus, Users, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { useOrgStore, TeamMember, Organization } from '../../../stores/orgStore';
import { GlassButton } from '../../shared/GlassButton';
import { InviteCodeDisplay } from './InviteCodeDisplay';

function formatRoleLabel(role: string): string {
  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const roleClass: Record<string, string> = {
  super_admin: 'bg-orange-500/10 text-orange-400',
  admin: 'bg-blue-500/10 text-blue-400',
  member: 'bg-white/10 text-gray-300',
};

function formatJoined(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function useRoleInOrg(
  org: Organization | null,
  userId: string | undefined
): 'super_admin' | 'admin' | 'member' {
  const { orgMembers } = useOrgStore();
  return useMemo(() => {
    if (!org || !userId) return 'member';
    if (org.owner_id === userId) return 'super_admin';
    const m = orgMembers.find(
      (x) => x.organization_id === org.id && x.user_id === userId
    );
    if (m) return m.role;
    return 'member';
  }, [org, orgMembers, userId]);
}

interface TeamPageProps {
  teamId: string;
  onUserViewChange: (view: string) => void;
}

const USER_PROFILE_VIEW = 'user-general';

export const TeamPage: React.FC<TeamPageProps> = ({ teamId, onUserViewChange }) => {
  const { user } = useAuthStore();
  const {
    activeOrganization,
    teams,
    teamMembers,
    fetchTeamMembers,
    fetchTeams,
    error: orgError,
  } = useOrgStore();

  const [fetching, setFetching] = useState(true);
  const [copyFlash, setCopyFlash] = useState(false);
  const [resolvingTeam, setResolvingTeam] = useState(true);
  const userRole = useRoleInOrg(activeOrganization, user?.id);
  const canManage = userRole === 'super_admin' || userRole === 'admin';

  const team = useMemo(
    () => teams.find((t) => t.id === teamId) ?? null,
    [teams, teamId]
  );

  useEffect(() => {
    if (!activeOrganization) {
      setResolvingTeam(false);
      return;
    }
    if (team) {
      setResolvingTeam(false);
      return;
    }
    setResolvingTeam(true);
    void fetchTeams(activeOrganization.id).finally(() => setResolvingTeam(false));
  }, [activeOrganization, team, teamId, fetchTeams]);

  useEffect(() => {
    if (!team) return;
    setFetching(true);
    void fetchTeamMembers(team.id).finally(() => setFetching(false));
  }, [team?.id, team, fetchTeamMembers]);

  const members: TeamMember[] | undefined = team ? teamMembers[team.id] : undefined;
  const currentUserId = user?.id;
  const rows = members ?? [];
  const showTableLoading = fetching;

  const handleAddPeople = useCallback(async () => {
    if (!team?.invite_code) return;
    try {
      await navigator.clipboard.writeText(team.invite_code);
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 2000);
    } catch {
      window.alert(`Team invite code: ${team.invite_code}`);
    }
  }, [team?.invite_code]);

  const onBack = useCallback(() => {
    onUserViewChange(USER_PROFILE_VIEW);
  }, [onUserViewChange]);

  if (!activeOrganization) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-gray-500 p-6">
        <p className="text-sm">No organization selected.</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 text-sm text-blue-400 hover:underline"
        >
          Back to profile
        </button>
      </div>
    );
  }

  if (resolvingTeam && !team) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-gray-500" aria-label="Loading" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-gray-400 text-sm max-w-sm">
          This team is not in your list or you no longer have access.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 text-sm text-blue-400 hover:underline"
        >
          Back to profile
        </button>
      </div>
    );
  }

  if (team.organization_id !== activeOrganization.id) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-gray-400 text-sm max-w-sm">
          This team does not belong to the selected organization. Open it from the profile
          for <span className="text-gray-300">{activeOrganization.name}</span>, or return to
          your profile.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 text-sm text-blue-400 hover:underline"
        >
          Back to profile
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 w-full max-w-7xl mx-auto flex flex-col">
      <div className="text-xs text-gray-500 mb-2 shrink-0">
        <span className="text-gray-400">{activeOrganization.name}</span>
        <span className="mx-2">/</span>
        <span>Team</span>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 lg:gap-8">
        {/* Main column — back, title, members table */}
        <div className="min-h-0 flex flex-col overflow-y-auto pr-0 xl:pr-1 space-y-5">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Back to profile"
            >
              <ChevronLeft size={22} />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Users size={22} className="text-gray-400 shrink-0" />
                <span className="truncate">{team.name}</span>
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">Members in this team</p>
            </div>
          </div>

          {orgError && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-amber-200/90 text-sm">
              {orgError}
            </div>
          )}

          <div>
            <h2 className="text-sm font-medium text-white mb-2">Team members</h2>
            {showTableLoading ? (
              <p className="text-sm text-gray-500 py-8 text-center">Loading members…</p>
            ) : (
              <div className="rounded-xl border border-white/10 overflow-hidden bg-white/[0.03]">
                <div className="max-h-[min(50vh,420px)] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-black/25 text-left text-xs text-gray-500 uppercase tracking-wide">
                        <th className="px-3 py-2.5 font-medium">Name</th>
                        <th className="px-3 py-2.5 font-medium">Email</th>
                        <th className="px-3 py-2.5 font-medium w-24">Role</th>
                        <th className="px-3 py-2.5 font-medium w-32">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-3 py-8 text-center text-gray-500 text-sm"
                          >
                            No members yet. Use the invite on the right to add people.
                          </td>
                        </tr>
                      ) : (
                        rows.map((m) => {
                          const isYou = currentUserId != null && m.user_id === currentUserId;
                          const nameBase = m.full_name?.trim() || 'Unknown user';
                          const nameDisplay = isYou ? `${nameBase} (you)` : nameBase;
                          return (
                            <tr
                              key={m.id}
                              className="border-t border-white/5 hover:bg-white/[0.04]"
                            >
                              <td className="px-3 py-2.5 text-white max-w-[12rem]">
                                <span className="line-clamp-2">{nameDisplay}</span>
                              </td>
                              <td className="px-3 py-2.5 text-gray-400 max-w-[14rem] truncate">
                                {m.email ?? '—'}
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-xs ${
                                    roleClass[m.role] ?? 'bg-white/10 text-gray-300'
                                  }`}
                                >
                                  {formatRoleLabel(m.role)}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                                {formatJoined(m.joined_at)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column — invite & actions (sticky on large screens) */}
        <aside className="min-h-0 flex flex-col gap-4 xl:sticky xl:top-0 xl:self-start max-xl:border-t max-xl:border-white/10 max-xl:pt-6 xl:border-l xl:border-white/10 xl:pl-8">
          <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white">Invite to this team</h2>
            <p className="text-xs text-gray-500 leading-relaxed">
              People use this code in Lumen &quot;Join by Code&quot; to join <strong className="text-gray-300">{team.name}</strong> once they are already in the organization
              {activeOrganization ? ` (${activeOrganization.name})` : ''}.
            </p>
            {canManage ? (
              <InviteCodeDisplay code={team.invite_code} label="Team invite code" />
            ) : (
              <p className="text-xs text-gray-500">Ask an org admin to share the team invite code with you.</p>
            )}
            {canManage && (
              <GlassButton
                variant="primary"
                className="w-full"
                onClick={handleAddPeople}
                icon={<UserPlus size={16} />}
              >
                {copyFlash ? 'Code copied' : 'Add people (copy code)'}
              </GlassButton>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
