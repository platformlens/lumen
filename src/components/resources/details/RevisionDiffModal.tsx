import React, { useMemo } from 'react';
import ReactDOM from 'react-dom';
import { DiffEditor } from '@monaco-editor/react';
import { X, GitCompare } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import * as jsYaml from 'js-yaml';

interface Revision {
    name: string;
    revision: string;
    creationTimestamp: string;
    images: string[];
    spec: any;
    metadata: any;
    status: any;
}

interface RevisionDiffModalProps {
    isOpen: boolean;
    onClose: () => void;
    leftRevision: Revision;
    rightRevision: Revision;
}

function revisionToYaml(rev: Revision): string {
    // Build a clean object showing the meaningful parts of the revision
    const clean: any = {
        revision: rev.revision,
        name: rev.name,
        createdAt: rev.creationTimestamp,
        replicas: rev.spec?.replicas,
        template: {
            labels: rev.spec?.template?.metadata?.labels,
            annotations: rev.spec?.template?.metadata?.annotations,
            spec: rev.spec?.template?.spec,
        },
        selector: rev.spec?.selector,
    };

    // Remove undefined values for cleaner YAML
    return jsYaml.dump(clean, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        skipInvalid: true,
        sortKeys: false,
    });
}

export const RevisionDiffModal: React.FC<RevisionDiffModalProps> = ({
    isOpen,
    onClose,
    leftRevision,
    rightRevision,
}) => {
    const leftYaml = useMemo(() => revisionToYaml(leftRevision), [leftRevision]);
    const rightYaml = useMemo(() => revisionToYaml(rightRevision), [rightRevision]);

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="bg-[#111111] border border-white/10 rounded-2xl w-full h-full max-w-[90vw] max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex-none px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#0a0a0a]">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                                    <GitCompare size={16} className="text-blue-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Compare Revisions</h2>
                                    <p className="text-xs text-gray-400">
                                        Revision {leftRevision.revision} → Revision {rightRevision.revision}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                {/* Legend */}
                                <div className="flex items-center gap-3 text-xs">
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-3 h-3 rounded-sm bg-red-500/30 border border-red-500/40"></span>
                                        <span className="text-gray-400">Removed</span>
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-3 h-3 rounded-sm bg-green-500/30 border border-green-500/40"></span>
                                        <span className="text-gray-400">Added</span>
                                    </span>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Column Labels */}
                        <div className="flex-none grid grid-cols-2 border-b border-white/10 bg-[#0d0d0d]">
                            <div className="px-6 py-2 border-r border-white/10">
                                <span className="text-xs font-medium text-red-400/80">
                                    Revision {leftRevision.revision}
                                </span>
                                <span className="text-xs text-gray-500 ml-2">
                                    {new Date(leftRevision.creationTimestamp).toLocaleString()}
                                </span>
                            </div>
                            <div className="px-6 py-2">
                                <span className="text-xs font-medium text-green-400/80">
                                    Revision {rightRevision.revision}
                                </span>
                                <span className="text-xs text-gray-500 ml-2">
                                    {new Date(rightRevision.creationTimestamp).toLocaleString()}
                                </span>
                            </div>
                        </div>

                        {/* Diff Editor */}
                        <div className="flex-1 min-h-0 bg-[#0a0a0a]">
                            <DiffEditor
                                height="100%"
                                language="yaml"
                                theme="vs-dark"
                                original={leftYaml}
                                modified={rightYaml}
                                options={{
                                    renderSideBySide: true,
                                    readOnly: true,
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    fontSize: 13,
                                    fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
                                    lineNumbers: 'on',
                                    renderIndicators: true,
                                    originalEditable: false,
                                    diffWordWrap: 'on',
                                    scrollbar: {
                                        verticalScrollbarSize: 8,
                                        horizontalScrollbarSize: 8,
                                    },
                                }}
                            />
                        </div>

                        {/* Footer */}
                        <div className="flex-none px-6 py-3 border-t border-white/10 bg-[#0a0a0a] flex justify-end">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 rounded-xl text-sm font-medium bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 hover:border-white/20 transition-all"
                            >
                                Close
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
};
