import React, { useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { ProfilePage } from './ProfilePage';
import { TeamPage } from './TeamPage';

type AuthMode = 'login' | 'register';

const USER_TEAM_PREFIX = 'user-team:';

export const AuthView: React.FC<{
  activeSection?: string;
  onUserViewChange?: (view: string) => void;
}> = ({ activeSection, onUserViewChange }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const { user, error, clearError } = useAuthStore();

  const handleToggleMode = () => {
    clearError();
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
  };

  if (user) {
    if (activeSection?.startsWith(USER_TEAM_PREFIX)) {
      const teamId = activeSection.slice(USER_TEAM_PREFIX.length);
      if (!teamId) {
        return (
          <div className="flex h-full min-h-0 w-full min-w-0 flex-col p-6">
            <p className="text-sm text-gray-500">Invalid team link.</p>
          </div>
        );
      }
      return (
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col p-6">
          <TeamPage
            teamId={teamId}
            onUserViewChange={onUserViewChange ?? (() => undefined)}
          />
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <ProfilePage
          onOpenTeamView={
            onUserViewChange ? (id) => onUserViewChange(USER_TEAM_PREFIX + id) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <div className="max-w-md mx-auto mt-16">
        <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-8">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 text-red-400 text-sm">
              {error}
            </div>
          )}

          {mode === 'login' ? <LoginForm /> : <RegisterForm />}

          <p className="text-center text-gray-400 text-sm mt-6">
            {mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={handleToggleMode}
                  className="text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={handleToggleMode}
                  className="text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
