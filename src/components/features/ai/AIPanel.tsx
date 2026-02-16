import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, MessageSquare, Trash2, ChevronRight, Copy, Check, AlertTriangle, Server, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion } from 'framer-motion';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

interface ChatSession {
    id: string;
    messages: ChatMessage[];
    resourceContext?: { name: string; type: string; namespace?: string };
    clusterContext?: string;
    model: string;
    provider: string;
    createdAt: number;
    updatedAt: number;
}

interface AIPanelProps {
    isOpen: boolean;
    onClose: () => void;
    currentExplanation?: string;
    isStreaming?: boolean;
    resourceContext?: { name: string; type: string; namespace?: string };
    clusterContext?: string;
    onSendPrompt?: (prompt: string) => void;
    onReloadConversation?: (conversation: Array<{ role: 'user' | 'assistant'; content: string }>, context: { name: string; type: string }) => void;
    onNewChat?: () => void;
    mode?: 'overlay' | 'sidebar';
}

const ThinkingDots = () => (
    <div className="flex gap-1 items-center h-4 px-2">
        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"></div>
    </div>
);

/** Detect if AI response contains a kubectl command block */
function extractKubectlCommands(text: string): string[] {
    const codeBlockRegex = /```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/g;
    const commands: string[] = [];
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        const block = match[1].trim();
        if (block.startsWith('kubectl')) {
            commands.push(block);
        }
    }
    return commands;
}

/** Check if a kubectl command is destructive */
function isDestructiveCommand(cmd: string): boolean {
    const destructiveKeywords = ['delete', 'drain', 'cordon'];
    const lower = cmd.toLowerCase();
    return destructiveKeywords.some(k => lower.includes(k));
}

/** Copy button for code blocks */
const CopyButton: React.FC<{ text: string }> = ({ text }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1 rounded bg-white/10 hover:bg-white/20 transition-colors text-gray-400 hover:text-white"
            title="Copy to clipboard"
        >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    );
};

/** Render a message with kubectl-aware formatting */
const MessageContent: React.FC<{ content: string; role: 'user' | 'assistant' }> = ({ content, role }) => {
    if (role === 'user') {
        return <>{content}</>;
    }

    // Check for destructive kubectl commands in the response
    const commands = extractKubectlCommands(content);
    const hasDestructive = commands.some(isDestructiveCommand);

    return (
        <div className="markdown-body prose prose-invert prose-sm max-w-none">
            {hasDestructive && (
                <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>This response contains destructive commands. Review carefully before executing.</span>
                </div>
            )}
            <ReactMarkdown
                components={{
                    code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeStr = String(children).replace(/\n$/, '');
                        if (match) {
                            return (
                                <div className="relative group">
                                    <CopyButton text={codeStr} />
                                    <pre className={className}><code {...props} className={className}>{children}</code></pre>
                                    {codeStr.startsWith('kubectl') && isDestructiveCommand(codeStr) && (
                                        <div className="flex items-center gap-1 mt-1 text-amber-400 text-[10px]">
                                            <AlertTriangle className="w-3 h-3" />
                                            <span>Destructive command</span>
                                        </div>
                                    )}
                                </div>
                            );
                        }
                        return <code {...props} className={className}>{children}</code>;
                    }
                }}
            >{content}</ReactMarkdown>
        </div>
    );
};

export const AIPanel: React.FC<AIPanelProps> = ({
    isOpen,
    onClose,
    currentExplanation,
    isStreaming,
    resourceContext,
    clusterContext,
    onSendPrompt,
    onReloadConversation,
    onNewChat,
    ...props
}) => {
    const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
    const [history, setHistory] = useState<ChatSession[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [displayMessages, setDisplayMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    // Track the last streaming content length to detect new chunks
    const lastStreamContentRef = useRef<string>('');

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const prevResourceContextRef = useRef<{ name: string; type: string; namespace?: string } | undefined>(undefined);

    const loadHistory = useCallback(async () => {
        try {
            const hist = await window.k8s.getHistory();
            setHistory(hist);
        } catch (err) {
            console.error("Failed to load history", err);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            loadHistory();
        }
    }, [isOpen, loadHistory]);

    // Handle resource context changes — save previous session, start new one
    useEffect(() => {
        if (!resourceContext) return;
        const prev = prevResourceContextRef.current;
        const changed = !prev || prev.name !== resourceContext.name || prev.type !== resourceContext.type || prev.namespace !== resourceContext.namespace;

        if (changed) {
            // Save previous session if it had messages
            if (prev) {
                window.k8s.saveCurrentSession().catch(() => { });
            }

            // Start new session for the new context
            window.k8s.startSession(resourceContext).catch(() => { });

            // Clear display
            setDisplayMessages([]);
            setActiveTab('chat');
            setSelectedSessionId(null);
            lastStreamContentRef.current = '';
            prevResourceContextRef.current = resourceContext;
        }
    }, [resourceContext?.name, resourceContext?.namespace, resourceContext?.type]);

    // Reload history when streaming finishes
    useEffect(() => {
        if (!isStreaming && isOpen) {
            loadHistory();
            // Save session when streaming completes
            window.k8s.saveCurrentSession().catch(() => { });
        }
    }, [isStreaming, isOpen, loadHistory]);

    // Accumulate streaming content and update display messages
    useEffect(() => {
        if (resourceContext && isStreaming && displayMessages.length === 0 && !currentExplanation) {
            setDisplayMessages([{ role: 'user', content: `Explain ${resourceContext.type} ${resourceContext.name}` }]);
            lastStreamContentRef.current = '';
        }

        if (currentExplanation && currentExplanation.trim()) {
            setDisplayMessages(prev => {
                // If the streaming content was reset (new response started), it will be shorter than what we last saw
                const isNewResponse = currentExplanation.length < lastStreamContentRef.current.length;

                if (isNewResponse) {
                    // New response stream started — append a new assistant message
                    lastStreamContentRef.current = currentExplanation;
                    return [...prev, { role: 'assistant', content: currentExplanation }];
                }

                lastStreamContentRef.current = currentExplanation;

                if (prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...updated[updated.length - 1], content: currentExplanation };
                    return updated;
                } else {
                    return [...prev, { role: 'assistant', content: currentExplanation }];
                }
            });
        }
    }, [currentExplanation, isStreaming, resourceContext]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [displayMessages, isStreaming]);

    const handleNewChat = () => {
        setDisplayMessages([]);
        setSelectedSessionId(null);
        setActiveTab('chat');
        lastStreamContentRef.current = '';
        if (onNewChat) onNewChat();
    };

    const handleSend = () => {
        if (!inputValue.trim()) return;
        const userMsg = inputValue;

        // Check for /kubectl prefix
        const isKubectl = userMsg.trimStart().startsWith('/kubectl');

        setDisplayMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setInputValue('');

        if (onSendPrompt) {
            onSendPrompt(isKubectl ? userMsg : userMsg);
        }
    };

    const handleSelectHistory = async (session: ChatSession) => {
        // Load the full session
        const loaded = await window.k8s.loadSession(session.id);
        if (!loaded) return;

        const msgs = loaded.messages.map((m: ChatMessage) => ({
            role: m.role,
            content: m.content
        }));
        setDisplayMessages(msgs);
        setActiveTab('chat');
        setSelectedSessionId(session.id);

        // Reload conversation in App.tsx for follow-up support
        if (onReloadConversation && loaded.resourceContext) {
            onReloadConversation(
                loaded.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
                { name: loaded.resourceContext.name, type: loaded.resourceContext.type }
            );
        }
    };

    const handleDeleteHistory = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        await window.k8s.deleteHistoryItem(id);
        loadHistory();
    };

    const handleClearHistory = async () => {
        if (confirm('Clear all AI history?')) {
            await window.k8s.clearHistory();
            loadHistory();
        }
    };

    const isOverlay = props.mode !== 'sidebar';
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const handleMouseDown = (e: MouseEvent) => { e.stopPropagation(); };
        panel.addEventListener('mousedown', handleMouseDown);
        return () => { panel.removeEventListener('mousedown', handleMouseDown); };
    }, []);

    /** Get a display label for a session */
    const getSessionLabel = (session: ChatSession) => {
        if (session.resourceContext) {
            return session.resourceContext.name;
        }
        // Fallback: first user message truncated
        const firstUser = session.messages.find(m => m.role === 'user');
        return firstUser ? firstUser.content.slice(0, 60) : 'Chat';
    };

    const getSessionType = (session: ChatSession) => {
        return session.resourceContext?.type || 'Conversation';
    };

    const getSessionPreview = (session: ChatSession) => {
        const lastAssistant = [...session.messages].reverse().find(m => m.role === 'assistant');
        return lastAssistant ? lastAssistant.content.slice(0, 100) : '';
    };

    return (
        <motion.div
            ref={panelRef}
            initial={isOverlay ? { x: 400, opacity: 0 } : { width: 0, opacity: 0 }}
            animate={isOverlay ? { x: 0, opacity: 1 } : { width: 450, opacity: 1 }}
            exit={isOverlay ? { x: 400, opacity: 0 } : { width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={`${isOverlay ? 'fixed top-0 right-0 h-screen z-[60]' : 'h-full border-l border-white/10 z-10 flex-none'} w-[450px] bg-[#0F0F0F] shadow-2xl flex flex-col`}
        >
            {/* Header */}
            <div className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-white/5 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                        <MessageSquare className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-sm text-white tracking-wide">AI Assistant</h2>
                        <p className="text-[10px] text-blue-400/80 font-medium">Lumen Intelligence</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={handleNewChat} className="p-2 hover:bg-white/10 rounded-full transition-all text-gray-400 hover:text-white" title="New Chat">
                        <Plus className="w-5 h-5" />
                    </button>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-all text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Cluster context indicator */}
            {clusterContext && (
                <div className="flex items-center gap-2 px-4 py-1.5 bg-emerald-500/5 border-b border-emerald-500/10 text-emerald-400 text-[11px]">
                    <Server className="w-3 h-3" />
                    <span>Context: {clusterContext}</span>
                </div>
            )}

            {/* Tabs */}
            <div className="flex p-2 gap-2 border-b border-white/5 bg-black/20">
                <button
                    onClick={() => setActiveTab('chat')}
                    className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${activeTab === 'chat' ? 'bg-blue-600/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                >
                    Current Chat
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${activeTab === 'history' ? 'bg-blue-600/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                >
                    History
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                {activeTab === 'chat' ? (
                    <div className="flex flex-col h-full">
                        <div className="flex-1 overflow-y-auto p-4 space-y-6">
                            {displayMessages.length === 0 && (
                                <div className="text-center py-10 opacity-50">
                                    <MessageSquare className="w-8 h-8 mx-auto mb-2" />
                                    {resourceContext ? (
                                        <p className="text-sm">Start asking about <br /><span className="text-blue-400 font-mono">{resourceContext.name}</span></p>
                                    ) : (
                                        <p className="text-sm">Ask anything about your cluster<br /><span className="text-blue-400/60 text-xs">Prefix with /kubectl for command generation</span></p>
                                    )}
                                </div>
                            )}

                            {displayMessages.map((msg, idx) => (
                                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] rounded-2xl p-3 text-sm ${msg.role === 'user'
                                        ? 'bg-blue-600 text-white rounded-br-sm'
                                        : 'bg-white/5 text-gray-300 rounded-bl-sm border border-white/5'
                                        }`}>
                                        <MessageContent content={msg.content} role={msg.role} />
                                    </div>
                                </div>
                            ))}

                            {isStreaming && (!displayMessages.length || displayMessages[displayMessages.length - 1].role !== 'assistant') && (
                                <div className="flex justify-start">
                                    <div className="bg-white/5 text-gray-300 rounded-2xl rounded-bl-sm p-3 border border-white/5">
                                        <ThinkingDots />
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="p-4 border-t border-white/10 bg-[#0F0F0F]/90 backdrop-blur-lg">
                            <div className="relative group">
                                <div className="absolute inset-0 bg-blue-500/5 rounded-xl blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
                                <textarea
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                    placeholder={resourceContext ? `Ask about ${resourceContext.name}...` : "Ask AI... (prefix /kubectl for commands)"}
                                    className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl py-4 pl-4 pr-12 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 focus:bg-[#202020] resize-none h-[60px] transition-all shadow-inner relative z-10"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!inputValue.trim()}
                                    className="absolute right-3 top-3 p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-900/20 z-20"
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="mt-3 flex items-center justify-center gap-2 opacity-40">
                                <div className="h-px w-8 bg-gradient-to-r from-transparent to-gray-500" />
                                <span className="text-[10px] text-gray-400 font-medium">AI can make mistakes</span>
                                <div className="h-px w-8 bg-gradient-to-l from-transparent to-gray-500" />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full overflow-y-auto p-2">
                        <div className="flex justify-between items-center px-2 mb-2">
                            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recent Chats</h3>
                            {history.length > 0 && (
                                <button onClick={handleClearHistory} className="text-[10px] text-red-400 hover:text-red-300">
                                    Clear All
                                </button>
                            )}
                        </div>
                        <div className="space-y-2">
                            {history.length === 0 ? (
                                <div className="text-center py-8 text-gray-600 text-sm">No history yet</div>
                            ) : (
                                history.map((session) => {
                                    const isCurrent = selectedSessionId === session.id;

                                    return (
                                        <div
                                            key={session.id}
                                            onClick={() => handleSelectHistory(session)}
                                            className={`group p-3 rounded-xl transition-all cursor-pointer relative border ${isCurrent
                                                ? 'bg-blue-500/10 border-blue-500/50'
                                                : 'bg-white/5 hover:bg-white/10 border-transparent hover:border-white/10'
                                                }`}
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-medium text-blue-400">{getSessionType(session)}</span>
                                                    {isCurrent && (
                                                        <span className="flex items-center gap-1 bg-blue-500/20 text-blue-300 text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                                            Current
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] text-gray-500">• {new Date(session.createdAt).toLocaleDateString()}</span>
                                                </div>
                                                <button
                                                    onClick={(e) => handleDeleteHistory(e, session.id)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded text-red-400 transition-all"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                            <div className="text-sm text-gray-300 line-clamp-2 font-medium mb-0.5">
                                                {getSessionLabel(session)}
                                            </div>
                                            <div className="text-xs text-gray-500 line-clamp-1">
                                                {getSessionPreview(session)}
                                            </div>
                                            <ChevronRight className="w-3 h-3 text-gray-600 absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );
};
