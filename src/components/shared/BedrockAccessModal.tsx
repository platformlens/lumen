import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, ExternalLink, X } from 'lucide-react';
import { GlassButton } from './GlassButton';

interface BedrockAccessModalProps {
    isOpen: boolean;
    onClose: () => void;
    modelId: string;
}

export const BedrockAccessModal: React.FC<BedrockAccessModalProps> = ({
    isOpen,
    onClose,
    modelId,
}) => {
    if (!isOpen) return null;

    const handleOpenConsole = () => {
        window.k8s.openExternal('https://console.aws.amazon.com/bedrock/home#/modelaccess');
    };

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <AnimatePresence>
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#1e1e1e] border border-white/10 rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <h3 className="text-white font-bold flex items-center gap-2">
                            <ShieldAlert size={20} className="text-amber-400" />
                            Model Access Required
                        </h3>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="p-6 space-y-4">
                        <p className="text-sm text-gray-300 leading-relaxed">
                            Your AWS account doesn't have access to this model:
                        </p>
                        <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                            <code className="text-xs text-blue-400 break-all">{modelId}</code>
                        </div>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            You need to enable model access in the AWS Bedrock console. Go to
                            Model Access, find this model, and subscribe to it. Changes can take
                            up to 2 minutes to take effect.
                        </p>
                        <p className="text-xs text-gray-500">
                            This is an AWS account permission issue, not an app bug.
                        </p>
                    </div>

                    <div className="p-4 border-t border-white/10 flex justify-end gap-3">
                        <GlassButton variant="secondary" onClick={onClose}>
                            Close
                        </GlassButton>
                        <GlassButton
                            variant="primary"
                            onClick={handleOpenConsole}
                            icon={<ExternalLink size={14} />}
                        >
                            Open Bedrock Console
                        </GlassButton>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
};
