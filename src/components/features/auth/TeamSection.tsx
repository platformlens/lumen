import React, { useState, useCallback } from 'react';
import { Users, Plus, ChevronRight } from 'lucide-react';
import { useOrgStore, Team } from '../../../stores/orgStore';
import { GlassButton } from '../../shared/GlassButton';

interface TeamSectionProps {
  userRole: 'super_admin' | 'admin' | 'member';
  onOpenTeamView?: (teamId: string) => void;
}

export const TeamSection: React.FC<TeamSectionProps> = ({
  userRole,
  onOpenTeamView,
}) => {
  const { teams, isLoading, error, createTeam } = useOrgStore();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [teamName, setTeamName] = useState('');

  const canManage = userRole === 'super_admin' || userRole === 'admin';

  const handleOpenTeam = useCallback(
    (team: Team) => {
      onOpenTeamView?.(team.id);
    },
    [onOpenTeamView]
  );

  const handleCreateTeam = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = teamName.trim();
      if (!trimmed) return;

      const created = await createTeam(trimmed);
      setTeamName('');
      setShowCreateForm(false);
      if (created && onOpenTeamView) {
        onOpenTeamView(created.id);
      }
    },
    [teamName, createTeam, onOpenTeamView]
  );

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

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {teams.length === 0 && !showCreateForm ? (
        <p className="text-sm text-gray-400 py-2">No teams yet.</p>
      ) : (
        <div className="space-y-1">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => handleOpenTeam(team)}
              className="w-full text-left pl-3 pr-2 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors flex items-center justify-between gap-2 group"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Users size={14} className="text-gray-400 shrink-0" />
                <span className="truncate">{team.name}</span>
              </span>
              <ChevronRight
                size={16}
                className="shrink-0 text-gray-500 group-hover:text-gray-300"
                aria-hidden
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
