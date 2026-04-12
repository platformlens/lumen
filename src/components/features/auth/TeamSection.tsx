import React, { useState, useCallback, useEffect } from 'react';
import { Users, Plus } from 'lucide-react';
import { useOrgStore, Organization, Team } from '../../../stores/orgStore';
import { GlassButton } from '../../shared/GlassButton';
import { MemberList } from './MemberList';
import { InviteCodeDisplay } from './InviteCodeDisplay';

interface TeamSectionProps {
  organization: Organization;
  userRole: 'super_admin' | 'admin' | 'member';
}

export const TeamSection: React.FC<TeamSectionProps> = ({ organization, userRole }) => {
  const { teams, teamMembers, isLoading, error, createTeam, fetchTeamMembers } = useOrgStore();

  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [teamName, setTeamName] = useState('');

  const canManage = userRole === 'super_admin' || userRole === 'admin';

  const handleSelectTeam = useCallback(
    async (team: Team) => {
      setSelectedTeam(team);
      await fetchTeamMembers(team.id);
    },
    [fetchTeamMembers]
  );

  const handleCreateTeam = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = teamName.trim();
      if (!trimmed) return;

      await createTeam(trimmed);
      setTeamName('');
      setShowCreateForm(false);
    },
    [teamName, createTeam]
  );

  // Clear selected team when the organization changes
  useEffect(() => {
    setSelectedTeam(null);
  }, [organization.id]);

  const selectedMembers = selectedTeam ? teamMembers[selectedTeam.id] ?? [] : [];
  const isMembersLoading = selectedTeam ? !teamMembers[selectedTeam.id] && isLoading : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <Users size={16} className="text-gray-400" />
          Teams
        </h4>
        {canManage && !showCreateForm && (
          <GlassButton
            variant="primary"
            onClick={() => setShowCreateForm(true)}
            icon={<Plus size={14} />}
            className="text-xs px-3 py-1"
          >
            Create Team
          </GlassButton>
        )}
      </div>

      {/* Create team form */}
      {showCreateForm && canManage && (
        <form onSubmit={handleCreateTeam} className="space-y-3">
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <GlassButton
              type="submit"
              variant="primary"
              isLoading={isLoading}
              disabled={!teamName.trim()}
              className="text-xs"
            >
              Create
            </GlassButton>
            <GlassButton
              type="button"
              variant="secondary"
              onClick={() => {
                setShowCreateForm(false);
                setTeamName('');
              }}
              className="text-xs"
            >
              Cancel
            </GlassButton>
          </div>
        </form>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Team list */}
      {teams.length === 0 && !showCreateForm ? (
        <p className="text-sm text-gray-400 py-2">No teams yet.</p>
      ) : (
        <div className="space-y-1">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => handleSelectTeam(team)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedTeam?.id === team.id
                  ? 'bg-white/10 text-white'
                  : 'text-gray-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2">
                <Users size={14} className="text-gray-400 shrink-0" />
                {team.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Selected team detail */}
      {selectedTeam && (
        <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-4">
          <h5 className="text-sm font-semibold text-white">{selectedTeam.name}</h5>

          {canManage && (
            <InviteCodeDisplay
              code={selectedTeam.invite_code}
              label="Team Invite Code"
            />
          )}

          <div>
            <p className="text-xs text-gray-400 mb-2">Members</p>
            <MemberList members={selectedMembers} isLoading={isMembersLoading} />
          </div>
        </div>
      )}
    </div>
  );
};
