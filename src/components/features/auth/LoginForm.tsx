import React, { useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { GlassButton } from '../../shared/GlassButton';
import { GithubAuthButton } from './GithubAuthButton';

export const LoginForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { signIn, isLoading, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    await signIn(email, password);
  };

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="login-email" className="block text-sm text-gray-400 mb-1">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>

      <div>
        <label htmlFor="login-password" className="block text-sm text-gray-400 mb-1">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>

      <GlassButton
        type="submit"
        variant="primary"
        isLoading={isLoading}
        className="w-full"
      >
        {isLoading ? 'Signing in...' : 'Sign In'}
      </GlassButton>
    </form>
    <GithubAuthButton />
  </>
  );
};
