import React from 'react';
import { Network, Square } from 'lucide-react';

interface PortActionsProps {
    port: any;
    targetPortVal: any;
    activeForward: any;
    onForward: () => void;
    onStop: () => void;
}

export const PortActions: React.FC<PortActionsProps> = ({ activeForward, onForward, onStop }) => {
    return (
        <div className="flex justify-end items-center gap-2">
            {activeForward ? (
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => window.k8s.openExternal(`http://localhost:${activeForward.localPort}`)}
                        className="text-xs text-green-400 hover:text-green-300 underline font-mono truncate max-w-[100px]"
                    >
                        :{activeForward.localPort}
                    </button>
                    <button
                        onClick={onStop}
                        className="p-1.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                        title="Stop Forwarding"
                    >
                        <Square size={12} fill="currentColor" />
                    </button>
                </div>
            ) : (
                <button
                    onClick={onForward}
                    className="px-2 py-1 rounded bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 text-xs flex items-center gap-1 transition-colors"
                >
                    <Network size={12} /> Forward
                </button>
            )}
        </div>
    );
};
