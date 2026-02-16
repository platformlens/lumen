import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2, CheckCheck, AlertTriangle, AlertCircle, Info, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

interface Notification {
    id: string;
    anomalyId?: string;
    type: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    resourceName: string;
    resourceKind: string;
    resourceNamespace?: string;
    createdAt: number;
    read: boolean;
}

interface NotificationsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onExplainAnomaly?: (notification: Notification) => void;
    onClear?: () => void;
}

const SeverityIcon: React.FC<{ severity: string }> = ({ severity }) => {
    switch (severity) {
        case 'critical':
            return <AlertCircle className="w-4 h-4 text-red-400" />;
        case 'warning':
            return <AlertTriangle className="w-4 h-4 text-amber-400" />;
        default:
            return <Info className="w-4 h-4 text-blue-400" />;
    }
};

const severityBg: Record<string, string> = {
    critical: 'border-l-red-500/50 bg-red-500/5',
    warning: 'border-l-amber-500/50 bg-amber-500/5',
    info: 'border-l-blue-500/50 bg-blue-500/5',
};

function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ isOpen, onClose, onExplainAnomaly, onClear }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const panelRef = useRef<HTMLDivElement>(null);

    const loadNotifications = async () => {
        try {
            const all = await window.k8s.notifications.getAll();
            setNotifications(all);
        } catch (err) {
            console.error('Failed to load notifications', err);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadNotifications();
        }
    }, [isOpen]);

    const handleMarkAllRead = async () => {
        await window.k8s.notifications.markAllRead();
        loadNotifications();
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        await window.k8s.notifications.delete(id);
        loadNotifications();
    };

    const handleClearAll = async () => {
        await window.k8s.notifications.clear();
        setNotifications([]);
        onClear?.();
    };

    const handleClick = async (notif: Notification) => {
        if (!notif.read) {
            await window.k8s.notifications.markRead(notif.id);
            loadNotifications();
        }
    };

    const unreadCount = notifications.filter(n => !n.read).length;

    if (!isOpen) return null;

    return (
        <motion.div
            ref={panelRef}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-8 left-2 w-[380px] max-h-[500px] bg-[#111111] border border-white/10 rounded-xl shadow-2xl flex flex-col z-[110] overflow-hidden"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Notifications</span>
                    {unreadCount > 0 && (
                        <span className="bg-blue-500/20 text-blue-400 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                            {unreadCount}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {unreadCount > 0 && (
                        <button
                            onClick={handleMarkAllRead}
                            className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white"
                            title="Mark all as read"
                        >
                            <CheckCheck className="w-3.5 h-3.5" />
                        </button>
                    )}
                    {notifications.length > 0 && (
                        <button
                            onClick={handleClearAll}
                            className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-red-400"
                            title="Clear all"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-gray-400 hover:text-white"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Notification list */}
            <div className="flex-1 overflow-y-auto">
                {notifications.length === 0 ? (
                    <div className="text-center py-10 text-gray-600 text-sm">No notifications</div>
                ) : (
                    notifications.map(notif => (
                        <div
                            key={notif.id}
                            onClick={() => handleClick(notif)}
                            className={`group flex items-start gap-3 px-4 py-3 border-b border-white/5 border-l-2 cursor-pointer transition-colors hover:bg-white/5 ${severityBg[notif.severity] || severityBg.info} ${!notif.read ? 'bg-opacity-100' : 'opacity-60'}`}
                        >
                            <div className="mt-0.5 flex-shrink-0">
                                <SeverityIcon severity={notif.severity} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-xs font-medium text-white truncate">{notif.type}</span>
                                    <span className="text-[10px] text-gray-500">{timeAgo(notif.createdAt)}</span>
                                    {!notif.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />}
                                </div>
                                <p className="text-xs text-gray-400 line-clamp-2">{notif.message}</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] text-gray-500 font-mono">{notif.resourceKind}/{notif.resourceName}</span>
                                    {onExplainAnomaly && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onExplainAnomaly(notif); }}
                                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-all"
                                        >
                                            <Sparkles className="w-3 h-3" />
                                            Explain
                                        </button>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={(e) => handleDelete(e, notif.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded text-red-400 transition-all flex-shrink-0"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </motion.div>
    );
};
