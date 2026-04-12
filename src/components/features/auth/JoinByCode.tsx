import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useOrgStore } from '../../../stores/orgStore';
import { GlassButton } from '../../shared/GlassButton';

export const JoinByCode: React.FC = () => {
  const [code, setCode] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { joinByCode, isLoading, error, clearError } = useOrgStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    // Clear previous messages when starting a new join attempt
    setSuccessMessage(null);
    setCode('');
    clearError();

    const result = await joinByCode(trimmedCode);

    if (result) {
      const entityLabel = result.type === 'org' ? 'organization' : 'team';
      setSuccessMessage(`Successfully joined ${entityLabel}: ${result.name}`);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="invite-code" className="block text-sm text-gray-400 mb-1">
          Invite Code
        </label>
        <input
          id="invite-code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter invite code"
          className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>

      {successMessage && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-green-400 text-sm">
          {successMessage}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <GlassButton
        type="submit"
        variant="primary"
        isLoading={isLoading}
        disabled={!code.trim()}
        icon={<UserPlus size={16} />}
        className="w-full"
      >
        {isLoading ? 'Joining...' : 'Join'}
      </GlassButton>
    </form>
  );
};
