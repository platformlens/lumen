import React from 'react';
import { Terminal, Bell, Wifi, Server } from 'lucide-react';
import { clsx } from 'clsx';

interface StatusBarProps {
    activeCluster: string | null;
    onTogglePanel: () => void;
    isPanelOpen: boolean;
    notificationCount?: number;
    aiProvider?: 'google' | 'bedrock';
    aiModel?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
    activeCluster,
    onTogglePanel,
    isPanelOpen,
    notificationCount = 0,
    aiProvider,
    aiModel
}) => {
    // Format model name to be more readable
    const formatModelName = (model: string) => {
        if (!model) return '';

        // Remove provider prefixes and region codes
        // e.g., "us.anthropic.claude-3-5-sonnet-20241022-v2:0" -> "Claude 3.5 Sonnet"
        // e.g., "anthropic.claude-3-sonnet-20240229-v1:0" -> "Claude 3 Sonnet"
        // e.g., "gemini-2.0-flash-exp" -> "Gemini 2.0 Flash"

        let formatted = model;

        // Remove region prefix (us., eu., etc.)
        formatted = formatted.replace(/^[a-z]{2}\./i, '');

        // Remove provider prefix (anthropic., amazon., etc.)
        formatted = formatted.replace(/^(anthropic|amazon|meta)\./i, '');

        // Remove version suffix (v1:0, v2:0, etc.)
        formatted = formatted.replace(/-v\d+:\d+$/i, '');

        // Remove date stamps (20240229, etc.)
        formatted = formatted.replace(/-\d{8}/g, '');

        // Remove -exp suffix
        formatted = formatted.replace(/-exp$/i, '');

        // Convert to title case and clean up
        formatted = formatted
            .split(/[-_]/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        return formatted;
    };

    return (
        <div className="h-6 bg-[#0a0a0a] border-t border-white/10 text-gray-400 flex items-center justify-between px-2 text-xs select-none z-50">
            {/* Left Section */}
            <div className="flex items-center h-full">
                <button
                    onClick={onTogglePanel}
                    className={clsx(
                        "flex items-center gap-1.5 px-2 h-full hover:bg-white/10 transition-colors focus:outline-none",
                        isPanelOpen && "bg-white/20"
                    )}
                    title="Toggle Terminal (Ctrl+`)"
                >
                    <Terminal size={12} />
                    <span>Terminal</span>
                </button>

                <button className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 transition-colors focus:outline-none">
                    <Bell size={12} />
                    {notificationCount > 0 && (
                        <span className="bg-white/20 px-1 rounded-full text-[10px]">{notificationCount}</span>
                    )}
                </button>
            </div>

            {/* Right Section */}
            <div className="flex items-center h-full gap-4">
                {activeCluster ? (
                    <div className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 hover:text-gray-200 transition-colors cursor-pointer">
                        <Server size={12} />
                        <span>{activeCluster}</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 px-2 h-full text-gray-600">
                        <Server size={12} />
                        <span>No Cluster</span>
                    </div>
                )}

                <div className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 transition-colors cursor-pointer">
                    <Wifi size={12} />
                    <span>Online</span>
                </div>

                {/* AI Model Indicator */}
                {aiProvider && aiModel && (
                    <div className="flex items-center gap-1.5 px-2 h-full hover:bg-white/10 hover:text-gray-200 transition-colors cursor-pointer" title={`AI: ${aiModel}`}>
                        {aiProvider === 'google' ? (
                            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
                                <path d="M6.76 14.96l-2.7 1.56C2.52 15.27 1.5 13.74 1.5 12s1.02-3.27 2.56-4.52l2.7 1.56c-.6.58-.98 1.39-.98 2.28s.38 1.7.98 2.28z" fill="#FF9900" />
                                <path d="M12 6.76V3.5c1.74 0 3.27 1.02 4.52 2.56l-1.56 2.7c-.58-.6-1.39-.98-2.28-.98s-1.7.38-2.28.98L8.84 6.06C10.09 4.52 11.62 3.5 12 3.5z" fill="#FF9900" />
                                <path d="M17.24 9.04l2.7-1.56C21.48 8.73 22.5 10.26 22.5 12s-1.02 3.27-2.56 4.52l-2.7-1.56c.6-.58.98-1.39.98-2.28s-.38-1.7-.98-2.28z" fill="#FF9900" />
                                <path d="M12 17.24v3.26c-1.74 0-3.27-1.02-4.52-2.56l1.56-2.7c.58.6 1.39.98 2.28.98s1.7-.38 2.28-.98l1.56 2.7c-1.25 1.54-2.78 2.56-4.16 2.56z" fill="#FF9900" />
                            </svg>
                        )}
                        <span className="truncate max-w-[120px]">{formatModelName(aiModel)}</span>
                    </div>
                )}
            </div>
        </div>
    );
};
