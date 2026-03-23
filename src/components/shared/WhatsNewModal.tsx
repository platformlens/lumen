import React from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { GlassButton } from './GlassButton';
import { WHATS_NEW_RELEASES } from '../../data/whats-new';
import { findRelease } from '../../utils/whats-new-utils';

interface WhatsNewModalProps {
    isOpen: boolean;
    onDismiss: () => void;
    appVersion: string;
}

export const WhatsNewModal: React.FC<WhatsNewModalProps> = ({ isOpen, onDismiss, appVersion }) => {
    const release = findRelease(WHATS_NEW_RELEASES, appVersion);

    return (
        <AnimatePresence>
            {isOpen && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md"
                    onClick={onDismiss}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="bg-[#141414] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Sticky Header */}
                        <div className="sticky top-0 bg-[#141414] border-b border-white/10 p-5 pb-4 flex-shrink-0">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] uppercase tracking-widest text-gray-500">
                                        LUMEN V{appVersion}
                                    </span>
                                    <h2 className="text-xl font-semibold text-white">
                                        {release?.title ?? `Version ${appVersion}`}
                                    </h2>
                                    {release && (
                                        <p className="text-sm text-gray-400">{release.description}</p>
                                    )}
                                </div>
                                <button
                                    onClick={onDismiss}
                                    className="text-gray-500 hover:text-white transition-colors flex-shrink-0 mt-1"
                                    aria-label="Close"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Scrollable Body */}
                        <div className="overflow-y-auto flex-1 p-5 space-y-6">
                            {release ? (
                                release.sections.map((section) => (
                                    <div key={section.title}>
                                        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                                            <div className={`w-1 h-5 ${section.colorAccent} rounded-full`} />
                                            {section.title}
                                        </h3>
                                        <ul className="space-y-2 pl-3">
                                            {section.items.map((item, i) => (
                                                <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                                                    <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-500 flex-shrink-0" />
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))
                            ) : (
                                <p className="text-gray-400 text-sm">
                                    No release notes available for v{appVersion}.
                                </p>
                            )}
                        </div>

                        {/* Sticky Footer */}
                        <div className="sticky bottom-0 bg-[#141414] border-t border-white/10 p-5 pt-4 flex justify-end flex-shrink-0">
                            <GlassButton variant="primary" onClick={onDismiss}>
                                What's New — Got it!
                            </GlassButton>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
