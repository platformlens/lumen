import React, { useState } from 'react';
import { X, Check, Activity } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { GlassButton } from './GlassButton';

interface ScaleModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentReplicas: number;
    resourceName: string;
    onScale: (replicas: number) => Promise<void>;
}

export const ScaleModal: React.FC<ScaleModalProps> = ({ isOpen, onClose, currentReplicas, resourceName, onScale }) => {
    const [replicas, setReplicas] = useState(currentReplicas);
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await onScale(replicas);
            onClose();
        } catch (err) {
            console.error(err);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <AnimatePresence>
                <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#1e1e1e] border border-white/10 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden"
                >
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <h3 className="text-white font-bold flex items-center gap-2">
                            <Activity size={18} className="text-blue-400"/>
                            Scale Deployment
                        </h3>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                    
                    <form onSubmit={handleSubmit} className="p-6">
                        <div className="mb-6">
                            <p className="text-gray-400 text-sm mb-4">
                                Scale <span className="text-white font-mono">{resourceName}</span> replicas.
                            </p>
                            
                            <div className="flex items-center justify-center gap-4">
                                <button 
                                    type="button"
                                    onClick={() => setReplicas(Math.max(0, replicas - 1))}
                                    className="w-10 h-10 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-xl font-bold transition-colors"
                                >
                                    -
                                </button>
                                <input
                                    type="number"
                                    min="0"
                                    value={replicas}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (!isNaN(val) && val >= 0) {
                                            setReplicas(val);
                                        } else if (e.target.value === '') {
                                            // Allow empty temporarily while typing
                                            setReplicas(0); // Or handle empty state differently if preferred
                                        }
                                    }}
                                    className="text-4xl font-mono font-bold text-blue-400 w-20 text-center bg-transparent border-none outline-none focus:ring-0 p-0 appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <button 
                                    type="button"
                                    onClick={() => setReplicas(replicas + 1)}
                                    className="w-10 h-10 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-xl font-bold transition-colors"
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <GlassButton
                                type="button"
                                variant="secondary"
                                onClick={onClose}
                            >
                                Cancel
                            </GlassButton>
                            <GlassButton
                                type="submit"
                                variant="primary"
                                isLoading={isSubmitting}
                                icon={<Check size={16} />}
                            >
                                Save Changes
                            </GlassButton>
                        </div>
                    </form>
                </motion.div>
            </AnimatePresence>
        </div>
    );
};
