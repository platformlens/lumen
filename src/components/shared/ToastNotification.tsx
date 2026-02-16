import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, AlertTriangle, X } from 'lucide-react';

interface ToastProps {
    id: string;
    message: string;
    type?: 'success' | 'error' | 'info';
    duration?: number;
    onClose: (id: string) => void;
    action?: { label: string; onClick: () => void };
}

export const ToastNotification: React.FC<ToastProps> = ({ id, message, type = 'success', duration = 3000, onClose, action }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose(id);
        }, action ? 8000 : duration); // longer duration when there's an action
        return () => clearTimeout(timer);
    }, [id, duration, onClose, action]);

    const bgClass = type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400'
        : type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : 'bg-blue-500/10 border-blue-500/20 text-blue-400';

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -20, x: 20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-md min-w-[300px] pointer-events-auto ${bgClass}`}
        >
            {type === 'success' ? <Check size={18} /> : type === 'error' ? <AlertTriangle size={18} /> : <div />}
            <span className="text-sm font-medium flex-1">{message}</span>
            {action && (
                <button
                    onClick={() => { action.onClick(); onClose(id); }}
                    className="text-xs font-medium px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors whitespace-nowrap"
                >
                    {action.label}
                </button>
            )}
            <button onClick={() => onClose(id)} className="hover:bg-white/10 p-1 rounded transition-colors">
                <X size={14} />
            </button>
        </motion.div>
    );
};
