import React, { useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { ProfilePage } from './ProfilePage';

type AuthMode = 'login' | 'register';

export const AuthView: React.FC<{ activeSection?: string }> = ({ activeSection: _activeSection }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const { user, error, clearError } = useAuthStore();

  const handleToggleMode = () => {
    clearError();
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
  };

  if (user) {
    return <ProfilePage />;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
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
