import React, { useState } from 'react';
import { useAuthStore, validatePassword } from '../../../stores/authStore';
import { GlassButton } from '../../shared/GlassButton';
import { GithubAuthButton } from './GithubAuthButton';

export const RegisterForm: React.FC = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const { signUp, isLoading, clearError } = useAuthStore();

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (value.length > 0 && !validatePassword(value)) {
      setPasswordError('Password must be at least 6 characters');
    } else {
      setPasswordError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validatePassword(password)) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    clearError();
    await signUp(email, password, fullName);
  };

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="register-fullname" className="block text-sm text-gray-400 mb-1">
          Full Name
        </label>
        <input
          id="register-fullname"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="John Doe"
          required
          className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>

      <div>
        <label htmlFor="register-email" className="block text-sm text-gray-400 mb-1">
          Email
        </label>
        <input
          id="register-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>

      <div>
        <label htmlFor="register-password" className="block text-sm text-gray-400 mb-1">
          Password
        </label>
        <input
          id="register-password"
          type="password"
          value={password}
          onChange={(e) => handlePasswordChange(e.target.value)}
          placeholder="••••••••"
          required
          className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
        {passwordError && (
          <p className="text-red-400 text-xs mt-1">{passwordError}</p>
        )}
      </div>

      <GlassButton
        type="submit"
        variant="primary"
        isLoading={isLoading}
        className="w-full"
      >
        {isLoading ? 'Creating account...' : 'Create Account'}
      </GlassButton>
    </form>
    <GithubAuthButton />
    </>
  );
};
