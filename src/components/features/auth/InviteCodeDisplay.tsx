import React, { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface InviteCodeDisplayProps {
  code: string;
  label: string;
}

export const InviteCodeDisplay: React.FC<InviteCodeDisplayProps> = ({ code, label }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in some environments
    }
  }, [code]);

  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
        <span className="font-mono text-sm text-white tracking-wider flex-1">
          {code}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
          aria-label={copied ? 'Copied' : 'Copy invite code'}
        >
          {copied ? (
            <Check size={16} className="text-green-400" />
          ) : (
            <Copy size={16} />
          )}
        </button>
      </div>
      {copied && (
        <p className="text-xs text-green-400 mt-1">Copied!</p>
      )}
    </div>
  );
};
