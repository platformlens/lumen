import React from 'react';
import { LogOut } from 'lucide-react';
import { useAuthStore, getInitials } from '../../../stores/authStore';
import { GlassButton } from '../../shared/GlassButton';
import { OrgSection } from './OrgSection';
import { JoinByCode } from './JoinByCode';

export const ProfilePage: React.FC = () => {
  const { profile, signOut, isLoading } = useAuthStore();

  const initials = profile?.full_name ? getInitials(profile.full_name) : '';

  const formattedDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <div className="w-1 h-8 bg-orange-500 rounded-full"></div>
            Profile
          </h2>
          <GlassButton
            variant="danger"
            onClick={signOut}
            isLoading={isLoading}
            icon={<LogOut size={16} />}
          >
            Sign Out
          </GlassButton>
        </div>

        {/* Two-column grid: 60/40 */}
        <div className="grid grid-cols-[3fr_2fr] gap-6 items-start">
          {/* Left column — Profile + Sign Out */}
          <div className="space-y-6">
            {/* Profile Card */}
            <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-lg p-8">
              <div className="flex items-center gap-6 mb-8">
                {/* Avatar */}
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.full_name}
                    className="w-20 h-20 rounded-full object-cover border-2 border-white/10"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-blue-500/20 border-2 border-blue-500/20 flex items-center justify-center">
                    <span className="text-2xl font-bold text-blue-400">{initials}</span>
                  </div>
                )}

                {/* Name & Email */}
                <div>
                  <h3 className="text-xl font-semibold text-white">
                    {profile?.full_name || 'Unknown User'}
                  </h3>
                  <p className="text-gray-400 text-sm mt-1">{profile?.email || ''}</p>
                </div>
              </div>

              {/* Info Section */}
              <div className="space-y-4">
                <div>
                  <p className="text-gray-400 text-sm">Full Name</p>
                  <p className="text-white mt-1">{profile?.full_name || '—'}</p>
                </div>
                <div className="w-full h-px bg-white/10"></div>
                <div>
                  <p className="text-gray-400 text-sm">Email</p>
                  <p className="text-white mt-1">{profile?.email || '—'}</p>
                </div>
                <div className="w-full h-px bg-white/10"></div>
                <div>
                  <p className="text-gray-400 text-sm">Member Since</p>
                  <p className="text-white mt-1">{formattedDate || '—'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right column — Organizations + Join by Code */}
          <div className="space-y-6">
            <OrgSection />

            <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Join by Code</h3>
              <JoinByCode />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
