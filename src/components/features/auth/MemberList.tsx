import React from 'react';
import { Loader2 } from 'lucide-react';

interface MemberListProps {
  members: Array<{
    full_name?: string;
    email?: string;
    role: string;
    joined_at: string;
  }>;
  isLoading: boolean;
}

const roleBadgeStyles: Record<string, string> = {
  super_admin: 'bg-orange-500/10 text-orange-400',
  admin: 'bg-blue-500/10 text-blue-400',
  member: 'bg-white/10 text-gray-300',
};

function formatRoleLabel(role: string): string {
  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDate(dateString: string): string {
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

export const MemberList: React.FC<MemberListProps> = ({ members, isLoading }) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4 text-center">No members found.</p>
    );
  }

  return (
    <div>
      {members.map((member, index) => (
        <div
          key={`${member.email ?? ''}-${member.role}-${index}`}
          className={`flex items-center justify-between py-3 px-2 ${
            index < members.length - 1 ? 'border-b border-white/5' : ''
          }`}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">
              {member.full_name || 'Unknown User'}
            </p>
            {member.email && (
              <p className="text-xs text-gray-400 truncate">{member.email}</p>
            )}
          </div>

          <div className="flex items-center gap-3 ml-4 shrink-0">
            <span
              className={`px-2 py-0.5 rounded text-xs ${
                roleBadgeStyles[member.role] ?? 'bg-white/10 text-gray-300'
              }`}
            >
              {formatRoleLabel(member.role)}
            </span>
            <span className="text-xs text-gray-400">
              {formatDate(member.joined_at)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};
