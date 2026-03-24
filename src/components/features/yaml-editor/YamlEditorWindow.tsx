import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PenTool, Minus } from 'lucide-react';
import { YamlEditor } from './YamlEditor';

interface YamlEditorWindowProps {
    isOpen: boolean;
    title: string;
    subtitle?: string;
    yamlContent: string;
    onSave: (content: string) => Promise<void>;
    onClose: () => void;
    onDockBack: () => void;
}

export const YamlEditorWindow: React.FC<YamlEditorWindowProps> = ({
    isOpen,
    title,
    subtitle,
    yamlContent,
    onSave,
    onClose,
    onDockBack,
}) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[190]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                    />

                    {/* Floating window */}
                    <motion.div
                        className="fixed inset-8 z-[195] flex flex-col rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-[#0a0a0a]"
                        initial={{ opacity: 0, scale: 0.97, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: 8 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        {/* Mac-style title bar */}
                        <div className="flex-none flex items-center gap-3 px-4 h-10 bg-[#171717] border-b border-white/10 select-none">
                            {/* Traffic light buttons */}
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={onClose}
                                    className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center group"
                                    title="Close"
                                >
                                    <X size={7} className="opacity-0 group-hover:opacity-100 text-red-900" />
                                </button>
                                <button
                                    onClick={onDockBack}
                                    className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors flex items-center justify-center group"
                                    title="Dock back to panel"
                                >
                                    <Minus size={7} className="opacity-0 group-hover:opacity-100 text-yellow-900" />
                                </button>
                                {/* Green dot — no fullscreen action, just decorative */}
                                <div className="w-3 h-3 rounded-full bg-green-500/40" />
                            </div>

                            {/* Title */}
                            <div className="flex-1 flex items-center justify-center gap-2">
                                <PenTool size={12} className="text-yellow-400" />
                                <span className="text-xs font-medium text-gray-300">{title}</span>
                                {subtitle && (
                                    <>
                                        <span className="text-gray-600">·</span>
                                        <span className="text-xs text-gray-500">{subtitle}</span>
                                    </>
                                )}
                            </div>

                            {/* Right spacer to balance the traffic lights */}
                            <div className="w-[54px]" />
                        </div>

                        {/* Editor */}
                        <div className="flex-1 min-h-0">
                            <YamlEditor
                                initialYaml={yamlContent}
                                onSave={onSave}
                            />
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
