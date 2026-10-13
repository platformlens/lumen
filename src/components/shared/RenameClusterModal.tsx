import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil, X } from 'lucide-react';
import { GlassButton } from './GlassButton';

interface RenameClusterModalProps {
    isOpen: boolean;
    currentName: string;
    /** Names of all existing contexts (used to block duplicates before calling the main process). */
    existingNames: string[];
    /** Resolves null on success (modal closes) or an error message (modal stays open). */
    onConfirm: (newName: string) => Promise<string | null>;
    onCancel: () => void;
}

interface RenameFormProps extends Omit<RenameClusterModalProps, 'isOpen'> { }

const RenameForm: React.FC<RenameFormProps> = ({ currentName, existingNames, onConfirm, onCancel }) => {
    const [value, setValue] = useState(currentName);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const trimmed = value.trim();
    const duplicate = useMemo(
        () => trimmed !== currentName && existingNames.includes(trimmed),
        [trimmed, currentName, existingNames]
    );
    const canSubmit = trimmed.length > 0 && trimmed !== currentName && !duplicate && !isSubmitting;
    const hint = duplicate ? `A context named "${trimmed}" already exists.` : error;

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    // Esc cancels, regardless of where focus is inside the modal
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isSubmitting) {
                e.stopPropagation();
                onCancel();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [isSubmitting, onCancel]);

    const submit = async () => {
        if (!canSubmit) return;
        setIsSubmitting(true);
        setError(null);
        try {
            const result = await onConfirm(trimmed);
            if (result !== null) setError(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to rename context.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-cluster-title"
        >
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <h3 id="rename-cluster-title" className="text-white font-bold flex items-center gap-2">
                    <Pencil size={16} className="text-blue-400" />
                    Rename Cluster
                </h3>
                <button
                    type="button"
                    onClick={onCancel}
                    className="text-gray-400 hover:text-white transition-colors"
                    disabled={isSubmitting}
                    aria-label="Close"
                >
                    <X size={18} />
                </button>
            </div>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                }}
            >
                <div className="p-4 space-y-2">
                    <label htmlFor="rename-cluster-input" className="block text-xs text-gray-400">
                        Context name in your kubeconfig
                    </label>
                    <input
                        id="rename-cluster-input"
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => {
                            setValue(e.target.value);
                            setError(null);
                        }}
                        disabled={isSubmitting}
                        spellCheck={false}
                        autoComplete="off"
                        maxLength={512}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono outline-none focus:border-blue-500/50 transition-colors"
                    />
                    {hint && <p className="text-xs text-red-400" role="alert">{hint}</p>}
                </div>

                <div className="p-4 border-t border-white/10 flex justify-end gap-3">
                    <GlassButton type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
                        Cancel
                    </GlassButton>
                    <GlassButton type="submit" variant="primary" disabled={!canSubmit} isLoading={isSubmitting}>
                        Rename
                    </GlassButton>
                </div>
            </form>
        </motion.div>
    );
};

export const RenameClusterModal: React.FC<RenameClusterModalProps> = ({
    isOpen,
    currentName,
    existingNames,
    onConfirm,
    onCancel,
}) => ReactDOM.createPortal(
    // Portal to body: sidebar ancestors use backdrop-filter, which would otherwise trap `fixed` positioning
    <AnimatePresence>
        {isOpen && (
            <motion.div
                key="rename-cluster-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[200] flex items-center justify-center bg-black/20 backdrop-blur-sm"
                onClick={onCancel}
            >
                <RenameForm
                    currentName={currentName}
                    existingNames={existingNames}
                    onConfirm={onConfirm}
                    onCancel={onCancel}
                />
            </motion.div>
        )}
    </AnimatePresence>,
    document.body
);
