import React, { useState, useEffect, useRef } from 'react';
import { X, Send, History, MessageSquare, Trash2, Clock, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'framer-motion';

interface AIHistoryItem {
    id: string;
    timestamp: number;
    prompt: string;
    response: string;
    resourceName?: string;
    resourceType?: string;
    model?: string;
    provider?: string;
}

interface AIPanelProps {
    isOpen: boolean;
    onClose: () => void;
    currentExplanation?: string; // If streaming in from Dashboard
    isStreaming?: boolean;
    resourceContext?: { name: string; type: string; namespace?: string };
    onSendPrompt?: (prompt: string) => void; // For follow-up chat
    mode?: 'overlay' | 'sidebar';
}

const ThinkingDots = () => (
    <div className="flex gap-1 items-center h-4 px-2">
        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"></div>
    </div>
);

export const AIPanel: React.FC<AIPanelProps> = ({
    isOpen,
    onClose,
    currentExplanation,
    isStreaming,
    resourceContext,
    onSendPrompt,
    ...props
}) => {
    const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
    const [history, setHistory] = useState<AIHistoryItem[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [localChat, setLocalChat] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

    // Ref for auto-scrolling
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const loadHistory = async () => {
        try {
            const hist = await window.k8s.getHistory();
            setHistory(hist);
        } catch (err) {
            console.error("Failed to load history", err);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadHistory();
        }
    }, [isOpen]);

    // Reset chat when context changes
    useEffect(() => {
        if (resourceContext) {
            // Only reset if it's a different resource than what we might have had?
            // Since we don't track "previousContext", we assume any change here implies new selection.
            // But we must be careful not to reset if it's the SAME object ref but we need to check values.
            // To be safe, just clearing localChat is fine because when we select a resource, we expect a fresh start usually.
            // However, we must NOT clear if we are in the middle of streaming for THIS resource.
            // The isStreaming check in the other effect handles the "prompt" insertion.
            setLocalChat([]);
            setActiveTab('chat');
            setSelectedHistoryId(null);
        }
    }, [resourceContext?.name, resourceContext?.namespace, resourceContext?.type]);

    // Reload history when streaming finishes
    useEffect(() => {
        if (!isStreaming && isOpen) {
            loadHistory();
        }
    }, [isStreaming, isOpen]);

    // Update local chat when streaming explanation comes in
    useEffect(() => {
        // If we have a context and streaming starts, ensure we show the "prompt" from user perspective
        if (resourceContext && isStreaming && localChat.length === 0) {
            setLocalChat([{ role: 'user', content: `Explain ${resourceContext.type} ${resourceContext.name}` }]);
        }

        if (currentExplanation) {
            setLocalChat(prev => {
                // If the last message is AI, update it.
                if (prev.length > 0 && prev[prev.length - 1].role === 'ai') {
                    const newChat = [...prev];
                    newChat[newChat.length - 1].content = currentExplanation;
                    return newChat;
                } else {
                    // If last was user (which we just added above), append AI
                    return [...prev, { role: 'ai', content: currentExplanation }];
                }
            });
        }
    }, [currentExplanation, isStreaming, resourceContext]);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [localChat, isStreaming]);

    const handleSend = () => {
        if (!inputValue.trim()) return;

        // Add user message immediately
        const userMsg = inputValue;
        setLocalChat(prev => [...prev, { role: 'user', content: userMsg }]);
        setInputValue('');

        // Trigger callback
        if (onSendPrompt) {
            onSendPrompt(userMsg);
        }
    };

    const handleSelectHistory = (item: AIHistoryItem) => {
        // Load this item into view
        setLocalChat([
            { role: 'user', content: `Explain ${item.resourceType} ${item.resourceName}\n\n${item.prompt || ''}` }, // Reconstruct context
            { role: 'ai', content: item.response }
        ]);
        setActiveTab('chat');
        setSelectedHistoryId(item.id);
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

    return (

        <motion.div
            initial={isOverlay ? { x: 400, opacity: 0 } : { width: 0, opacity: 0 }}
            animate={isOverlay ? { x: 0, opacity: 1 } : { width: 450, opacity: 1 }}
            exit={isOverlay ? { x: 400, opacity: 0 } : { width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={`${isOverlay ? 'fixed top-0 right-0 h-screen z-[60]' : 'h-full border-l border-white/10 z-10 flex-none'} w-[450px] bg-[#0F0F0F] shadow-2xl flex flex-col`}
        >
            {/* Header */}
            <div className="h-14 border-b border-white/5 flex items-center justify-between px-4 bg-white/5 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-500/20 rounded-lg">
                        <MessageSquare className="w-4 h-4 text-blue-400" />
                    </div>
                    <span className="font-medium text-sm text-gray-200">AI Assistant</span>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
                    <X className="w-4 h-4 text-gray-400" />
                </button>
            </div>

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
                        {/* Chat Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-6">
                            {resourceContext && localChat.length === 0 && (
                                <div className="text-center py-10 opacity-50">
                                    <MessageSquare className="w-8 h-8 mx-auto mb-2" />
                                    <p className="text-sm">Start asking about <br /><span className="text-blue-400 font-mono">{resourceContext.name}</span></p>
                                </div>
                            )}

                            {localChat.map((msg, idx) => (
                                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] rounded-2xl p-3 text-sm ${msg.role === 'user'
                                        ? 'bg-blue-600 text-white rounded-br-sm'
                                        : 'bg-white/5 text-gray-300 rounded-bl-sm border border-white/5'
                                        }`}>
                                        {msg.role === 'ai' ? (
                                            <div className="markdown-body prose prose-invert prose-sm max-w-none">
                                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                                            </div>
                                        ) : (
                                            msg.content
                                        )}
                                    </div>
                                </div>
                            ))}

                            {/* Thinking Indicator */}
                            {isStreaming && (!localChat.length || localChat[localChat.length - 1].role !== 'ai') && (
                                <div className="flex justify-start">
                                    <div className="bg-white/5 text-gray-300 rounded-2xl rounded-bl-sm p-3 border border-white/5">
                                        <ThinkingDots />
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="p-4 border-t border-white/10 bg-black/20">
                            <div className="relative">
                                <textarea
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                    placeholder={resourceContext ? `Ask about ${resourceContext.name}...` : "Ask AI..."}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-4 pr-12 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none h-[50px]"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!inputValue.trim()}
                                    className="absolute right-2 top-1.5 p-1.5 bg-blue-500 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
                                >
                                    <Send className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <div className="text-[10px] text-gray-600 mt-2 text-center">
                                AI may generate incorrect info. Check important details.
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
                                history.map((item, index) => {
                                    const isCurrent = selectedHistoryId
                                        ? item.id === selectedHistoryId
                                        : (resourceContext && item.resourceName === resourceContext.name && item.resourceType === resourceContext.type && history.findIndex(h => h.resourceName === resourceContext.name && h.resourceType === resourceContext.type) === index);

                                    return (
                                        <div
                                            key={item.id}
                                            onClick={() => handleSelectHistory(item)}
                                            className={`group p-3 rounded-xl transition-all cursor-pointer relative border ${isCurrent
                                                ? 'bg-blue-500/10 border-blue-500/50'
                                                : 'bg-white/5 hover:bg-white/10 border-transparent hover:border-white/10'
                                                }`}
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-medium text-blue-400">{item.resourceType || 'Resource'}</span>
                                                    {isCurrent && (
                                                        <span className="flex items-center gap-1 bg-blue-500/20 text-blue-300 text-[9px] px-1.5 py-0.5 rounded-full font-medium">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                                                            Current
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] text-gray-500">• {new Date(item.timestamp).toLocaleDateString()}</span>
                                                </div>
                                                <button
                                                    onClick={(e) => handleDeleteHistory(e, item.id)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded text-red-400 transition-all"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                            <div className="text-sm text-gray-300 line-clamp-2 font-medium mb-0.5">
                                                {item.resourceName || 'Unknown Resource'}
                                            </div>
                                            <div className="text-xs text-gray-500 line-clamp-1">
                                                {item.response}
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
