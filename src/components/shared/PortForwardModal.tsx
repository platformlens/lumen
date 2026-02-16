import React, { useState } from 'react';
import { X, Play, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PortForwardModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStart: (localPort: number) => void;
    serviceName: string;
    targetPort: number;
}

export const PortForwardModal: React.FC<PortForwardModalProps> = ({ 
    isOpen, 
    onClose, 
    onStart, 
    serviceName, 
    targetPort 
}) => {
    const [localPort, setLocalPort] = useState<string>('');
    const [useRandom, setUseRandom] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        // Simulate a small delay for better UX or validation if needed
        const port = useRandom ? 0 : parseInt(localPort);
        
        try {
            await onStart(port);
            onClose();
        } catch (err) {
            console.error("Failed to start port forward", err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#1e1e1e] rounded-xl border border-[#333] w-full max-w-md shadow-2xl overflow-hidden"
                >
                    <div className="flex items-center justify-between p-4 border-b border-[#333]">
                        <h3 className="font-semibold text-white">Port Forward to {serviceName}</h3>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="p-6 space-y-6">
                        <div className="space-y-4">
                            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-200">
                                Forwarding to target port <span className="font-mono font-bold">{targetPort}</span>
                            </div>

                            <div className="space-y-3">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useRandom ? 'bg-blue-500 border-blue-500' : 'border-gray-500 bg-transparent group-hover:border-gray-400'}`}>
                                        {useRandom && <div className="w-2 h-2 bg-white rounded-sm" />}
                                    </div>
                                    <input 
                                        type="checkbox" 
                                        checked={useRandom} 
                                        onChange={(e) => setUseRandom(e.target.checked)} 
                                        className="hidden"
                                    />
                                    <span className="text-gray-300">Use random local port</span>
                                </label>

                                <div className={`transition-all duration-200 ${useRandom ? 'opacity-50 pointer-events-none grayscale' : 'opacity-100'}`}>
                                    <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Local Port</label>
                                    <input 
                                        type="number" 
                                        value={localPort}
                                        onChange={(e) => setLocalPort(e.target.value)}
                                        placeholder="e.g. 8080"
                                        className="w-full bg-[#252526] border border-[#333] rounded px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                                        disabled={useRandom}
                                        min="1"
                                        max="65535"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-2">
                             <button 
                                type="button" 
                                onClick={onClose}
                                className="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm font-medium"
                            >
                                Cancel
                            </button>
                            <button 
                                type="submit" 
                                disabled={isLoading || (!useRandom && !localPort)}
                                className={`
                                    px-4 py-2 rounded flex items-center gap-2 text-sm font-medium
                                    bg-blue-600 hover:bg-blue-500 text-white transition-all
                                    disabled:opacity-50 disabled:cursor-not-allowed
                                `}
                            >
                                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                                Start Forwarding
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
