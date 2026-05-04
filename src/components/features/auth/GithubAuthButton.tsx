import React from 'react';
import { Github } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { GlassButton } from '../../shared/GlassButton';

export const GithubAuthButton: React.FC = () => {
  const { signInWithGithub, isLoading, clearError } = useAuthStore();

  return (
    <>
      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-xs text-gray-500 shrink-0">or</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>
      <GlassButton
        type="button"
        variant="secondary"
        className="w-full"
        isLoading={isLoading}
        icon={<Github size={18} />}
        onClick={() => {
          clearError();
          void signInWithGithub();
        }}
      >
        Continue with GitHub
      </GlassButton>
    </>
  );
};
