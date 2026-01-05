import React, { useState } from 'react';
import { X, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { GlassButton } from './GlassButton';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
    isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'warning',
    isLoading = false
}) => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            await onConfirm();
            onClose();
        } catch (err) {
            console.error(err);
        } finally {
            setIsSubmitting(false);
        }
    };

    const getIcon = () => {
        switch (variant) {
            case 'danger':
                return <AlertCircle size={20} className="text-red-400" />;
            case 'warning':
                return <AlertTriangle size={20} className="text-yellow-400" />;
            case 'info':
                return <Info size={20} className="text-blue-400" />;
        }
    };

    const getConfirmButtonVariant = () => {
        return variant === 'danger' ? 'danger' : 'primary';
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <AnimatePresence>
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#1e1e1e] border border-white/10 rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <h3 className="text-white font-bold flex items-center gap-2">
                            {getIcon()}
                            {title}
                        </h3>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white transition-colors"
                            disabled={isSubmitting || isLoading}
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="p-6">
                        <p className="text-gray-300 text-sm leading-relaxed">
                            {message}
                        </p>
                    </div>

                    <div className="p-4 border-t border-white/10 flex justify-end gap-3">
                        <GlassButton
                            type="button"
                            variant="secondary"
                            onClick={onClose}
                            disabled={isSubmitting || isLoading}
                        >
                            {cancelText}
                        </GlassButton>
                        <GlassButton
                            type="button"
                            variant={getConfirmButtonVariant()}
                            onClick={handleConfirm}
                            isLoading={isSubmitting || isLoading}
                        >
                            {confirmText}
                        </GlassButton>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
};
