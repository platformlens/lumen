import React from 'react';
import { Mail } from 'lucide-react';
import { GlassButton } from '../../shared/GlassButton';

type Props = {
  email: string;
  onBackToSignIn: () => void;
};

export const EmailConfirmationPending: React.FC<Props> = ({ email, onBackToSignIn }) => {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6">
      <div className="max-w-md mx-auto mt-16">
        <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl p-8 text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600/15 border border-blue-500/20">
            <Mail className="h-7 w-7 text-blue-400" aria-hidden />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Check your inbox</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-6">
            We sent a confirmation link to{' '}
            <span className="text-white font-medium break-all">{email}</span>.
            Open that email and confirm your account before signing in.
          </p>
          <p className="text-gray-500 text-xs mb-8">
            After you confirm, return here and sign in with the same email and password. Check spam if you do not see the message within a few minutes.
          </p>
          <GlassButton type="button" variant="secondary" className="w-full" onClick={onBackToSignIn}>
            Back to sign in
          </GlassButton>
        </div>
      </div>
    </div>
  );
};
