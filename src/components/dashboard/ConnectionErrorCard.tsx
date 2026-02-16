import React from 'react';
import { RefreshCw, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';

interface ConnectionErrorCardProps {
    clusterName: string;
    error: any;
    onRetry: () => void;
}

export const ConnectionErrorCard: React.FC<ConnectionErrorCardProps> = ({ clusterName, error, onRetry }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gradient-to-br from-red-500/5 to-transparent rounded-2xl">
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-gray-900/50 backdrop-blur-xl border border-red-500/20 p-8 rounded-2xl max-w-md w-full shadow-2xl flex flex-col items-center gap-6"
            >
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center ring-1 ring-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
                    <XCircle size={32} className="text-red-500" />
                </div>

                <div className="space-y-2">
                    <h2 className="text-xl font-bold text-white">Connection Failed</h2>
                    <p className="text-gray-400 text-sm">
                        Could not connect to cluster <span className="font-mono text-gray-300 bg-white/5 px-1.5 py-0.5 rounded">{clusterName}</span>
                    </p>
                </div>

                <div className="w-full bg-black/40 rounded-lg p-4 text-left border border-white/5 font-mono text-xs text-red-300 overflow-x-auto">
                    {error?.message || "Unknown network error or authentication failure."}
                </div>

                <div className="flex gap-3 w-full pt-2">
                    <button
                        onClick={onRetry}
                        className="flex-1 flex items-center justify-center gap-2 bg-white text-black hover:bg-gray-200 active:bg-gray-300 px-4 py-2.5 rounded-lg font-medium transition-colors text-sm"
                    >
                        <RefreshCw size={16} />
                        Retry Connection
                    </button>
                </div>

                <div className="text-[10px] text-gray-600 font-mono">
                    {new Date().toLocaleTimeString()}
                </div>
            </motion.div>
        </div>
    );
};
