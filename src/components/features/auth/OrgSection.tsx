import React, { useState, useCallback } from 'react';
import { Building2, Plus, ChevronRight } from 'lucide-react';
import { useOrgStore, Organization } from '../../../stores/orgStore';
import { useAuthStore } from '../../../stores/authStore';
import { GlassButton } from '../../shared/GlassButton';
import { MemberList } from './MemberList';
import { InviteCodeDisplay } from './InviteCodeDisplay';
import { TeamSection } from './TeamSection';

export const OrgSection: React.FC = () => {
  const {
    organizations,
    activeOrganization,
    orgMembers,
    isLoading,
    error,
    createOrganization,
    setActiveOrganization,
  } = useOrgStore();
  const { user } = useAuthStore();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [orgName, setOrgName] = useState('');

  const handleCreateOrg = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = orgName.trim();
      if (!trimmed) return;

      await createOrganization(trimmed);
      setOrgName('');
      setShowCreateForm(false);
    },
    [orgName, createOrganization]
  );

  const handleSelectOrg = useCallback(
    async (org: Organization) => {
      if (activeOrganization?.id === org.id) {
        await setActiveOrganization(null);
      } else {
        await setActiveOrganization(org);
      }
    },
    [activeOrganization, setActiveOrganization]
  );

  /**
   * Determine the current user's role in a given organization
   * by looking up their membership in orgMembers.
   * Falls back to checking the active org's members when viewing the list.
   */
  const getUserRoleForOrg = useCallback(
    (org: Organization): 'super_admin' | 'admin' | 'member' => {
      if (!user) return 'member';
      // When the org is the active one and orgMembers is populated, use it
      if (activeOrganization?.id === org.id && orgMembers.length > 0) {
        const membership = orgMembers.find((m) => m.user_id === user.id);
        if (membership) return membership.role;
      }
      // Infer super_admin from owner_id
      if (org.owner_id === user.id) return 'super_admin';
      // Otherwise default to member
      return 'member';
    },
    [user, activeOrganization, orgMembers]
  );

  const activeUserRole = activeOrganization
    ? getUserRoleForOrg(activeOrganization)
    : null;

  const canViewInviteCode =
    activeUserRole === 'super_admin' || activeUserRole === 'admin';

  return (
    <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-lg p-6 space-y-6">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <div className="w-1 h-8 bg-orange-500 rounded-full"></div>
          Organizations
        </h2>
        {!showCreateForm && (
          <GlassButton
            variant="primary"
            onClick={() => setShowCreateForm(true)}
            icon={<Plus size={16} />}
          >
            Create Organization
          </GlassButton>
        )}
      </div>

      {/* Create org form */}
      {showCreateForm && (
        <form onSubmit={handleCreateOrg} className="space-y-3">
          <input
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Organization name"
            className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <GlassButton
              type="submit"
              variant="primary"
              isLoading={isLoading}
              disabled={!orgName.trim()}
            >
              Create
            </GlassButton>
            <GlassButton
              type="button"
              variant="secondary"
              onClick={() => {
                setShowCreateForm(false);
                setOrgName('');
              }}
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

      {/* Organization list */}
      {organizations.length === 0 && !showCreateForm ? (
        <p className="text-sm text-gray-400 py-2">
          You don't belong to any organizations yet. Create one or join with an invite code.
        </p>
      ) : (
        <div className="space-y-1">
          {organizations.map((org) => {
            const role = getUserRoleForOrg(org);
            return (
              <button
                key={org.id}
                type="button"
                onClick={() => handleSelectOrg(org)}
                className={`w-full text-left px-4 py-3 rounded-lg text-sm transition-colors flex items-center justify-between ${
                  activeOrganization?.id === org.id
                    ? 'bg-white/10 text-white'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Building2 size={16} className="text-gray-400 shrink-0" />
                  <span>{org.name}</span>
                  {role && (
                    <span className="text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded">
                      {role.replace('_', ' ')}
                    </span>
                  )}
                </span>
                <ChevronRight
                  size={14}
                  className={`text-gray-500 transition-transform ${
                    activeOrganization?.id === org.id ? 'rotate-90' : ''
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Active organization detail view */}
      {activeOrganization && activeUserRole && (
        <div className="bg-white/5 border border-white/10 rounded-lg p-5 space-y-6">
          {/* Org header */}
          <div>
            <h3 className="text-lg font-semibold text-white">
              {activeOrganization.name}
            </h3>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-gray-400">
                Role: <span className="text-gray-300">{activeUserRole.replace('_', ' ')}</span>
              </span>
              <span className="text-xs text-gray-400">
                Members: <span className="text-gray-300">{orgMembers.length}</span>
              </span>
            </div>
          </div>

          {/* Invite code for admin/super_admin */}
          {canViewInviteCode && (
            <InviteCodeDisplay
              code={activeOrganization.invite_code}
              label="Organization Invite Code"
            />
          )}

          {/* Org member list */}
          <div>
            <p className="text-xs text-gray-400 mb-2">Members</p>
            <MemberList members={orgMembers} isLoading={false} />
          </div>

          {/* Team section */}
          <TeamSection
            organization={activeOrganization}
            userRole={activeUserRole}
          />
        </div>
      )}
    </div>
  );
};
