import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Server, MessageSquare, Trash2, ChevronRight, Plus, Brain } from 'lucide-react';
import { nanoid } from 'nanoid';


import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageBranch,
  MessageBranchContent,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';

import {
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
  Attachments,
} from "@/components/ai-elements/attachments";

import {
  ModelSelectorLogo,
  ModelSelectorName,
} from "@/components/ai-elements/model-selector";

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtMarkdown,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";

import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";

import { hasUnclosedThinkingBlock, parseAssistantThinking } from "@/utils/ai-thinking";

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
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

type AppTheme = 'blue' | 'charcoal' | 'red';

/** Per-theme surfaces and accents so the panel matches App.tsx theme, not a generic glass layer. */
type AIPanelChrome = {
  panelEdge: string;
  header: string;
  headerIcon: string;
  headerIconGlyph: string;
  headerButtonHover: string;
  clusterStrip: string;
  tabRow: string;
  tabActive: string;
  tabInactive: string;
  sessionBanner: string;
  convDivide: string;
  prompt: string;
  attachment: string;
  contextPopover: string;
  contextBody: string;
  contextFooter: string;
  modelBadge: string;
  historyCard: string;
  historyCardActive: string;
  resizeHover: string;
  accentText: string;
  accentBg: string;
  accentMuted: string;
  accentPulseDot: string;
  messageUser: string;
  messageAssistant: string;
};

function getAIPanelChrome(t: AppTheme): AIPanelChrome {
  switch (t) {
    case 'blue':
      return {
        panelEdge: 'border-l border-slate-400/20',
        header:
          'border-b border-slate-500/20 bg-gradient-to-r from-slate-950/50 via-slate-950/35 to-transparent',
        headerIcon:
          'bg-blue-500/15 border border-blue-400/35 shadow-[0_0_16px_rgba(59,130,246,0.22)]',
        headerIconGlyph: 'text-sky-300',
        headerButtonHover: 'hover:bg-slate-500/15',
        clusterStrip:
          'bg-emerald-500/[0.06] border-b border-emerald-500/15 text-emerald-400',
        tabRow: 'border-b border-slate-500/20 bg-slate-950/20',
        tabActive: 'bg-sky-500/15 text-sky-100',
        tabInactive: 'text-muted-foreground hover:text-slate-100',
        sessionBanner: 'border border-slate-500/20 bg-slate-900/30',
        convDivide: 'divide-slate-500/10',
        prompt:
          'bg-slate-950/40 border border-slate-500/25 rounded-xl transition-colors focus-within:border-sky-500/35 [&_div[data-slot=input-group]]:border-none [&_div[data-slot=input-group]]:bg-transparent [&_div[data-slot=input-group]]:!ring-0 [&_div[data-slot=input-group]]:!shadow-none [&_div[data-slot=input-group]]:flex-col [&_div[data-slot=input-group]]:items-start [&_div[data-slot=input-group]]:divide-y [&_div[data-slot=input-group]]:divide-slate-500/10 [&_textarea]:!ring-0 [&_textarea]:!ring-offset-0 [&_textarea]:!shadow-none [&_textarea]:!outline-none [&_textarea]:!border-none',
        attachment: 'border border-slate-500/25 bg-slate-900/35 text-slate-200',
        contextPopover: 'border border-slate-500/25 bg-[#0c1018] shadow-2xl z-[120] opacity-100',
        contextBody: 'bg-[#0c1018]',
        contextFooter: 'bg-slate-950/90 border-t border-slate-500/20',
        modelBadge: 'border border-slate-500/20 bg-slate-900/35',
        historyCard:
          'border border-slate-500/20 bg-slate-900/25 hover:bg-slate-900/40 hover:border-slate-400/30',
        historyCardActive:
          'border border-sky-400/40 bg-sky-500/10 shadow-[0_0_24px_rgba(56,189,248,0.12)] ring-1 ring-sky-400/25',
        resizeHover: 'hover:bg-sky-400/45',
        accentText: 'text-sky-300',
        accentBg: 'bg-sky-500/20',
        accentMuted: 'text-sky-200/90',
        accentPulseDot: 'bg-sky-400',
        messageUser:
          'group-[.is-user]:bg-slate-800/45 group-[.is-user]:border-slate-500/25 group-[.is-user]:text-slate-100',
        messageAssistant:
          'group-[.is-assistant]:bg-slate-900/40 group-[.is-assistant]:border-slate-500/22 group-[.is-assistant]:text-slate-100',
      };
    case 'red':
      return {
        panelEdge: 'border-l border-red-500/25',
        header:
          'border-b border-red-900/35 bg-gradient-to-r from-red-950/45 via-red-950/25 to-transparent',
        headerIcon:
          'bg-red-500/20 border border-red-400/35 shadow-[0_0_16px_rgba(248,113,113,0.2)]',
        headerIconGlyph: 'text-red-200',
        headerButtonHover: 'hover:bg-red-500/10',
        clusterStrip:
          'bg-emerald-500/[0.06] border-b border-emerald-500/15 text-emerald-400',
        tabRow: 'border-b border-red-900/30 bg-red-950/20',
        tabActive: 'bg-red-500/15 text-red-50',
        tabInactive: 'text-muted-foreground hover:text-red-50/95',
        sessionBanner: 'border border-red-900/30 bg-red-950/25',
        convDivide: 'divide-red-950/40',
        prompt:
          'bg-red-950/30 border border-red-800/35 rounded-xl transition-colors focus-within:border-red-500/40 [&_div[data-slot=input-group]]:border-none [&_div[data-slot=input-group]]:bg-transparent [&_div[data-slot=input-group]]:!ring-0 [&_div[data-slot=input-group]]:!shadow-none [&_div[data-slot=input-group]]:flex-col [&_div[data-slot=input-group]]:items-start [&_div[data-slot=input-group]]:divide-y [&_div[data-slot=input-group]]:divide-red-950/35 [&_textarea]:!ring-0 [&_textarea]:!ring-offset-0 [&_textarea]:!shadow-none [&_textarea]:!outline-none [&_textarea]:!border-none',
        attachment: 'border border-red-800/35 bg-red-950/35 text-red-100/90',
        contextPopover: 'border border-red-900/35 bg-[#140a0a] shadow-2xl z-[120] opacity-100',
        contextBody: 'bg-[#140a0a]',
        contextFooter: 'bg-red-950/70 border-t border-red-900/30',
        modelBadge: 'border border-red-900/30 bg-red-950/30',
        historyCard:
          'border border-red-900/30 bg-red-950/20 hover:bg-red-950/35 hover:border-red-500/25',
        historyCardActive:
          'border border-red-400/45 bg-red-500/12 shadow-[0_0_24px_rgba(248,113,113,0.14)] ring-1 ring-red-400/30',
        resizeHover: 'hover:bg-red-400/45',
        accentText: 'text-red-300',
        accentBg: 'bg-red-500/20',
        accentMuted: 'text-red-100/90',
        accentPulseDot: 'bg-red-400',
        messageUser:
          'group-[.is-user]:bg-red-950/35 group-[.is-user]:border-red-800/35 group-[.is-user]:text-red-50/95',
        messageAssistant:
          'group-[.is-assistant]:bg-red-950/30 group-[.is-assistant]:border-red-900/30 group-[.is-assistant]:text-red-50/95',
      };
    case 'charcoal':
    default:
      return {
        panelEdge: 'border-l border-white/10',
        header:
          'border-b border-white/10 bg-gradient-to-r from-zinc-950/55 via-zinc-950/35 to-transparent',
        headerIcon:
          'bg-primary/20 border border-primary/30 shadow-[0_0_15px_rgba(59,130,246,0.28)]',
        headerIconGlyph: 'text-primary',
        headerButtonHover: 'hover:bg-white/10',
        clusterStrip:
          'bg-emerald-500/5 border-b border-emerald-500/10 text-emerald-500',
        tabRow: 'border-b border-white/10 bg-black/10',
        tabActive: 'bg-primary/20 text-primary',
        tabInactive: 'text-muted-foreground hover:text-foreground',
        sessionBanner: 'border border-white/10 bg-white/[0.04]',
        convDivide: 'divide-white/5',
        prompt:
          'bg-zinc-900/45 border border-white/10 rounded-xl transition-colors focus-within:border-white/18 [&_div[data-slot=input-group]]:border-none [&_div[data-slot=input-group]]:bg-transparent [&_div[data-slot=input-group]]:!ring-0 [&_div[data-slot=input-group]]:!shadow-none [&_div[data-slot=input-group]]:flex-col [&_div[data-slot=input-group]]:items-start [&_div[data-slot=input-group]]:divide-y [&_div[data-slot=input-group]]:divide-white/5 [&_textarea]:!ring-0 [&_textarea]:!ring-offset-0 [&_textarea]:!shadow-none [&_textarea]:!outline-none [&_textarea]:!border-none',
        attachment: 'border border-white/10 bg-white/5 text-gray-300',
        contextPopover: 'border border-white/10 bg-zinc-950 shadow-2xl z-[120] opacity-100',
        contextBody: 'bg-zinc-950',
        contextFooter: 'bg-black/45 border-t border-white/10',
        modelBadge: 'border border-white/8 bg-white/[0.06]',
        historyCard:
          'border border-white/10 bg-white/[0.05] hover:bg-white/[0.09] hover:border-white/16',
        historyCardActive:
          'border border-primary/40 bg-primary/10 shadow-[0_0_24px_rgba(59,130,246,0.15)] ring-1 ring-primary/25',
        resizeHover: 'hover:bg-primary/50',
        accentText: 'text-primary',
        accentBg: 'bg-primary/20',
        accentMuted: 'text-primary',
        accentPulseDot: 'bg-primary',
        messageUser:
          'group-[.is-user]:bg-zinc-900/40 group-[.is-user]:border-zinc-700/25 group-[.is-user]:text-zinc-100',
        messageAssistant:
          'group-[.is-assistant]:bg-zinc-900/45 group-[.is-assistant]:border-zinc-600/22 group-[.is-assistant]:text-zinc-100',
      };
  }
}

interface AIPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentExplanation?: string;
  isStreaming?: boolean;
  resourceContext?: { name: string; type: string; namespace?: string };
  clusterContext?: string;
  onSendPrompt?: (prompt: string) => void;
  onReloadConversation?: (
    conversation: Array<{ role: 'user' | 'assistant'; content: string }>,
    context: { name: string; type: string; namespace?: string },
    meta?: { model?: string; provider?: string }
  ) => void;
  onNewChat?: () => void;
  mode?: 'overlay' | 'sidebar';
  aiModel?: string;
  aiProvider?: string;
  /** Matches App root gradient so the panel reads as part of the shell, not a separate glass layer. */
  theme?: AppTheme;
  /** Pending tool call awaiting user approval */
  pendingToolApproval?: { toolCallId: string; command: string; isReadOnly: boolean } | null;
  /** Callback to approve/reject a tool call. trust=true saves the command pattern for auto-approval. */
  onToolApproval?: (approved: boolean, trust: boolean) => void;
  /** Abort the in-flight LLM stream (main process + IPC listeners). */
  onStopStreaming?: () => void;
}

interface MessageType {
  key: string;
  from: 'user' | 'assistant';
  versions: {
    id: string;
    content: string;
  }[];
}

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
  mode = 'sidebar',
  aiModel = 'GPT-4',
  aiProvider = 'openai',
  theme = 'charcoal',
  pendingToolApproval,
  onToolApproval,
  onStopStreaming,
}) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [text, setText] = useState<string>('');
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);

  const [panelWidth, setPanelWidth] = useState(450);
  const [isResizing, setIsResizing] = useState(false);
  const isDraggingRef = useRef(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = panelWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startX - moveEvent.clientX; // dragging left increases width
      const newWidth = Math.max(450, Math.min(window.innerWidth - 100, startWidth + delta));
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelWidth]);

  const lastStreamContentRef = useRef<string>('');
  const prevResourceContextRef = useRef<{ name: string; type: string; namespace?: string } | undefined>(undefined);
  /** When true, skip "new resource" reset — parent aiContext was synced from history, not a cluster navigation. */
  const hydratingFromHistoryRef = useRef(false);
  const isOverlay = mode !== 'sidebar';
  const chrome = useMemo(() => getAIPanelChrome(theme), [theme]);

  const loadHistory = useCallback(async () => {
    try {
      if (window.k8s && window.k8s.getHistory) {
        const hist = await window.k8s.getHistory();
        setHistory(hist || []);
      }
    } catch (err) {
      console.error('Failed to load history', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen, loadHistory]);

  useEffect(() => {
    if (!historyNotice) return;
    const t = window.setTimeout(() => setHistoryNotice(null), 8000);
    return () => window.clearTimeout(t);
  }, [historyNotice]);

  // Handle resource context changes — save previous session, start new one
  useEffect(() => {
    if (!resourceContext) return;
    const prev = prevResourceContextRef.current;
    const changed =
      !prev ||
      prev.name !== resourceContext.name ||
      prev.type !== resourceContext.type ||
      prev.namespace !== resourceContext.namespace;

    if (changed) {
      if (hydratingFromHistoryRef.current) {
        prevResourceContextRef.current = resourceContext;
        hydratingFromHistoryRef.current = false;
        return;
      }
      if (prev && window.k8s && window.k8s.saveCurrentSession) {
        window.k8s.saveCurrentSession().catch(() => {});
      }
      if (prev) {
        setHistoryNotice(
          'Kubernetes context changed — the previous chat was saved to history. Starting a fresh thread for this resource.'
        );
      }
      if (window.k8s && window.k8s.startSession) {
        window.k8s.startSession(resourceContext).catch(() => {});
      }
      setMessages([{
        key: nanoid(),
        from: 'user',
        versions: [{ id: nanoid(), content: `Explain ${resourceContext.type} ${resourceContext.name}` }]
      }]);
      setActiveTab('chat');
      setSelectedSessionId(null);
      lastStreamContentRef.current = '';
      prevResourceContextRef.current = resourceContext;
    }
  }, [resourceContext]);

  // Reload history when streaming finishes and save current session
  useEffect(() => {
    if (!isStreaming && isOpen) {
      loadHistory();
      if (window.k8s && window.k8s.saveCurrentSession) {
        window.k8s.saveCurrentSession().catch(() => {});
      }
    }
  }, [isStreaming, isOpen, loadHistory]);

  // Accumulate streaming content and update display messages
  const prevExplanationRef = useRef<string>('');

  useEffect(() => {
    if (currentExplanation !== undefined) {
      setMessages((prev) => {
        // If currentExplanation is cleared, we don't need to add anything
        if (currentExplanation === '') {
           return prev;
        }
        
        // If the explanation is completely new (e.g. shorter, or doesn't start with the previous one)
        const isNewResponse = currentExplanation.length < prevExplanationRef.current.length || !currentExplanation.startsWith(prevExplanationRef.current);

        if (isNewResponse || prev.length === 0 || prev[prev.length - 1].from === 'user') {
          // New response stream started — append a new assistant message
          const newAssistantMsg: MessageType = {
            key: nanoid(),
            from: 'assistant',
            versions: [{ id: nanoid(), content: currentExplanation }],
          };
          return [...prev, newAssistantMsg];
        } else {
          // Update last assistant message
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          const lastVersion = lastMsg.versions[lastMsg.versions.length - 1];
          lastMsg.versions[lastMsg.versions.length - 1] = { ...lastVersion, content: currentExplanation };
          return updated;
        }
      });
      prevExplanationRef.current = currentExplanation;
    }
  }, [currentExplanation]);

  const handleNewChat = useCallback(() => {
    if (window.k8s && window.k8s.saveCurrentSession) {
      window.k8s.saveCurrentSession().catch(() => {});
    }
    setMessages([]);
    setSelectedSessionId(null);
    setActiveTab('chat');
    lastStreamContentRef.current = '';
    if (onNewChat) onNewChat();
  }, [onNewChat]);

  const handleSend = useCallback((messageContent: string) => {
    if (!messageContent.trim()) return;

    const newMsg: MessageType = {
      key: nanoid(),
      from: 'user',
      versions: [{ id: nanoid(), content: messageContent }],
    };

    setMessages((prev) => [...prev, newMsg]);
    if (onSendPrompt) {
      onSendPrompt(messageContent);
    }
  }, [onSendPrompt]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!message.text?.trim()) return;
      handleSend(message.text);
      setText('');
    },
    [handleSend]
  );

  const handleSelectHistory = async (session: ChatSession) => {
    if (!window.k8s || !window.k8s.loadSession) return;
    if (window.k8s.saveCurrentSession) {
      await window.k8s.saveCurrentSession().catch(() => {});
    }
    const loaded = await window.k8s.loadSession(session.id);
    if (!loaded) {
      setHistoryNotice(
        'That chat could not be loaded. It may have been removed or cleared. You can start a new conversation.'
      );
      setSelectedSessionId(null);
      await loadHistory();
      return;
    }

    const msgs: MessageType[] = loaded.messages.map((m: ChatMessage) => ({
      key: nanoid(),
      from: m.role,
      versions: [{ id: nanoid(), content: m.content }],
    }));
    setMessages(msgs);
    setActiveTab('chat');
    setSelectedSessionId(session.id);
    lastStreamContentRef.current = '';
    setHistoryNotice(null);

    if (onReloadConversation) {
      hydratingFromHistoryRef.current = true;
      onReloadConversation(
        loaded.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
        loaded.resourceContext
          ? {
              name: loaded.resourceContext.name,
              type: loaded.resourceContext.type,
              namespace: loaded.resourceContext.namespace,
            }
          : { name: 'Chat', type: 'Conversation' },
        { model: loaded.model, provider: loaded.provider }
      );
    }
  };

  const handleDeleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.k8s && window.k8s.deleteHistoryItem) {
      await window.k8s.deleteHistoryItem(id);
      loadHistory();
    }
  };

  const handleClearHistory = async () => {
    if (window.confirm('Clear all AI history?')) {
      if (window.k8s && window.k8s.clearHistory) {
        await window.k8s.clearHistory();
        loadHistory();
      }
    }
  };

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handleMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.classList.contains('resize-handle')) {
        return;
      }
      e.stopPropagation();
    };
    panel.addEventListener('mousedown', handleMouseDown);
    return () => {
      panel.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const getSessionLabel = (session: ChatSession) => {
    if (session.resourceContext) return session.resourceContext.name;
    const firstUser = session.messages.find((m) => m.role === 'user');
    return firstUser ? firstUser.content.slice(0, 60) : 'Chat';
  };

  const getSessionType = (session: ChatSession) => {
    return session.resourceContext?.type || 'Conversation';
  };

  const getSessionPreview = (session: ChatSession) => {
    const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant');
    return lastAssistant ? lastAssistant.content.slice(0, 100) : '';
  };

  const status = useMemo(() => {
    if (isStreaming) return 'streaming';
    return 'ready';
  }, [isStreaming]);

  const isSubmitDisabled = useMemo(() => {
    if (status === 'streaming') return false;
    return !text.trim();
  }, [text, status]);

  const contextAttachments = useMemo(() => {
    const atts = [];
    if (clusterContext) {
      atts.push({
        id: 'cluster',
        type: 'source-document',
        title: `Cluster: ${clusterContext}`,
      });
    }
    if (resourceContext) {
      atts.push({
        id: 'resource',
        type: 'source-document',
        title: `${resourceContext.type}: ${resourceContext.name}`,
        mediaType: resourceContext.namespace ? `NS: ${resourceContext.namespace}` : 'Global',
      });
    }
    return atts;
  }, [clusterContext, resourceContext]);

  const estimatedTokens = useMemo(() => {
    const textLength = messages.reduce((acc, msg) => {
      const latestVersion = msg.versions[msg.versions.length - 1];
      return acc + (latestVersion ? latestVersion.content.length : 0);
    }, 0);
    return Math.ceil(textLength / 4);
  }, [messages]);

  const getProviderLogo = (provider: string) => {
    if (provider === 'bedrock') return 'amazon-bedrock';
    if (provider === 'google') return 'google';
    if (provider === 'local') return 'opencode';
    return provider;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          initial={isOverlay ? { x: panelWidth, opacity: 0 } : { width: 0, opacity: 0 }}
          animate={isOverlay ? { x: 0, opacity: 1 } : { width: panelWidth, opacity: 1 }}
          exit={isOverlay ? { x: panelWidth, opacity: 0 } : { width: 0, opacity: 0 }}
          transition={isResizing ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}
          style={isOverlay ? { width: panelWidth } : undefined}
          className={`${
            isOverlay ? `fixed top-0 right-0 h-screen z-[60] ${chrome.panelEdge}` : `h-full ${chrome.panelEdge} z-10 flex-none`
          } bg-transparent flex flex-col relative`}
        >
          {/* Resize Handle */}
          <div 
            className={`resize-handle absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize ${chrome.resizeHover} transition-colors z-50`}
            onMouseDown={startResizing}
          />
          
          {/* Header */}
          <div className={`h-16 flex items-center justify-between px-6 ${chrome.header}`}>
            <div className="flex items-center gap-3">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center ${chrome.headerIcon}`}>
                <MessageSquare className={`w-4 h-4 ${chrome.headerIconGlyph}`} />
              </div>
              <div>
                <h2 className="font-semibold text-sm tracking-wide">AI Assistant</h2>
                <p className="text-[10px] text-muted-foreground font-medium">Lumen Intelligence</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleNewChat}
                className={`p-2 ${chrome.headerButtonHover} rounded-full transition-all text-muted-foreground hover:text-foreground`}
                title="New Chat"
              >
                <Plus className="w-5 h-5" />
              </button>
              <button
                onClick={onClose}
                className={`p-2 ${chrome.headerButtonHover} rounded-full transition-all text-muted-foreground hover:text-foreground`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Cluster context indicator */}
          {clusterContext && (
            <div className={`flex items-center gap-2 px-4 py-1.5 text-[11px] ${chrome.clusterStrip}`}>
              <Server className="w-3 h-3" />
              <span>Context: {clusterContext}</span>
            </div>
          )}

          {/* Tabs */}
          <div className={`flex p-2 gap-2 ${chrome.tabRow}`}>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
                activeTab === 'chat' ? chrome.tabActive : chrome.tabInactive
              }`}
            >
              Current Chat
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
                activeTab === 'history' ? chrome.tabActive : chrome.tabInactive
              }`}
            >
              History
            </button>
          </div>

          {historyNotice && (
            <div className="mx-3 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/95 flex gap-2 items-start">
              <span className="leading-relaxed flex-1">{historyNotice}</span>
              <button
                type="button"
                onClick={() => setHistoryNotice(null)}
                className="shrink-0 text-amber-200/80 hover:text-amber-50 text-xs font-medium"
              >
                Dismiss
              </button>
            </div>
          )}

          {selectedSessionId && activeTab === 'chat' && !historyNotice && (
            <div className={`mx-3 mt-2 rounded-md px-3 py-1.5 text-[10px] text-muted-foreground ${chrome.sessionBanner}`}>
              Continuing a saved chat — new messages update this thread in history.
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-hidden relative">
            {activeTab === 'chat' ? (
              <div className={`relative flex size-full flex-col divide-y overflow-hidden ${chrome.convDivide}`}>
                <Conversation>
                  <ConversationContent>
                    {messages.length === 0 && (
                      <div className="flex items-center justify-center h-full text-muted-foreground flex-col gap-2 mt-20">
                         <MessageSquare className="w-8 h-8 opacity-50" />
                         <span className="text-sm">How can I help you today?</span>
                      </div>
                    )}
                    {messages.map(({ versions, ...message }, mIndex) => (
                      <MessageBranch defaultBranch={0} key={message.key}>
                        <MessageBranchContent>
                          {versions.map((version, vIndex) => {
                            const parsed = message.from === 'assistant' ? parseAssistantThinking(version.content) : { thinking: null, response: version.content };
                            const isCurrentStream = isStreaming && message.from === 'assistant' && mIndex === messages.length - 1 && vIndex === versions.length - 1;
                            const thinkingText = parsed.thinking ?? '';
                            // Show whenever we parsed a thinking envelope (including empty), so the trigger
                            // can show "Thought for X seconds" after streaming; also cover unclosed tags mid-stream.
                            const showReasoningBlock =
                              parsed.thinking !== null ||
                              (isCurrentStream && hasUnclosedThinkingBlock(version.content));
                            return (
                              <Message from={message.from} key={`${message.key}-${version.id}`}>
                                <MessageContent
                                  className={
                                    message.from === 'user' ? chrome.messageUser : chrome.messageAssistant
                                  }
                                >
                                  {showReasoningBlock && (
                                    <ChainOfThought
                                      isStreaming={isCurrentStream}
                                      className="mb-2"
                                      defaultOpen={false}
                                    >
                                      <ChainOfThoughtHeader />
                                      <ChainOfThoughtContent>
                                        <ChainOfThoughtStep
                                          icon={Brain}
                                          label="Reasoning trace"
                                          status={isCurrentStream ? 'active' : 'complete'}
                                        >
                                          {thinkingText.trim() ? (
                                            <ChainOfThoughtMarkdown>
                                              {thinkingText}
                                            </ChainOfThoughtMarkdown>
                                          ) : (
                                            <p className="text-xs italic text-muted-foreground">
                                              {isCurrentStream
                                                ? 'Waiting for reasoning text…'
                                                : 'No reasoning text was captured for this reply.'}
                                            </p>
                                          )}
                                        </ChainOfThoughtStep>
                                      </ChainOfThoughtContent>
                                    </ChainOfThought>
                                  )}
                                  {parsed.response ? (
                                    <MessageResponse>{parsed.response}</MessageResponse>
                                  ) : (
                                    message.from === 'user' && <MessageResponse>{version.content}</MessageResponse>
                                  )}
                                </MessageContent>
                              </Message>
                            );
                          })}
                        </MessageBranchContent>
                      </MessageBranch>
                    ))}
                    {isStreaming && messages.length > 0 && messages[messages.length - 1].from === 'user' && (
                       <Message from="assistant">
                         <MessageContent className={chrome.messageAssistant}>
                           <MessageResponse>...</MessageResponse>
                         </MessageContent>
                       </Message>
                    )}
                  </ConversationContent>
                  <ConversationScrollButton />
                </Conversation>
                
                <div className="grid shrink-0 gap-4 pt-4 pb-4 px-4 bg-transparent z-20">
                  {/* Local AI tool calling note */}
                  {aiProvider === 'local' && (
                    <div className="flex items-center gap-2 text-[11px] text-gray-500 bg-white/5 border border-white/5 rounded-lg px-3 py-1.5">
                      <svg viewBox="0 0 24 24" className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <span>Tool calling (agentic mode) is not yet fully supported for local AI models. For best results, use a model with native tool support (e.g. Qwen, Llama 3.1+).</span>
                    </div>
                  )}
                  {/* Tool Approval Banner */}
                  {pendingToolApproval && (
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs text-yellow-300 font-medium">
                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                        </svg>
                        AI wants to run a command
                      </div>
                      <code className="block text-xs text-white font-mono bg-black/30 rounded-lg px-3 py-2 break-all">
                        {pendingToolApproval.command}
                      </code>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onToolApproval?.(true, false)}
                          className="flex-1 px-3 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-medium hover:bg-green-500/30 transition-colors"
                        >
                          Allow
                        </button>
                        <button
                          onClick={() => onToolApproval?.(true, true)}
                          className="flex-1 px-3 py-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-medium hover:bg-blue-500/30 transition-colors"
                        >
                          Allow &amp; Trust
                        </button>
                        <button
                          onClick={() => onToolApproval?.(false, false)}
                          className="flex-1 px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs font-medium hover:bg-red-500/30 transition-colors"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  )}
                  <PromptInput 
                    globalDrop={false} 
                    multiple={false} 
                    onSubmit={handleSubmit}
                    className={chrome.prompt}
                  >
                    <PromptInputBody>
                      {contextAttachments.length > 0 && (
                        <Attachments variant="inline" className="px-3 pt-3 pb-0">
                          {contextAttachments.map((data) => (
                            <Attachment key={data.id} data={data as any} className={`cursor-default pointer-events-none ${chrome.attachment}`}>
                              <AttachmentPreview />
                              <AttachmentInfo showMediaType />
                            </Attachment>
                          ))}
                        </Attachments>
                      )}
                      <PromptInputTextarea 
                        onChange={(e) => setText(e.target.value)} 
                        value={text} 
                        placeholder="Message AI Assistant..." 
                      />
                    </PromptInputBody>
                    <PromptInputFooter>
                      <PromptInputTools>
                        <div className="flex items-center gap-2">
                          <Context
                            maxTokens={128000}
                            modelId={`${aiProvider}:${aiModel}`}
                            usage={{
                              cachedInputTokens: 0,
                              inputTokens: estimatedTokens,
                              outputTokens: 0,
                              reasoningTokens: 0,
                              totalTokens: estimatedTokens,
                            }}
                            usedTokens={estimatedTokens}
                          >
                            <ContextTrigger />
                            <ContextContent className={chrome.contextPopover}>
                              <ContextContentHeader />
                              <ContextContentBody className={chrome.contextBody}>
                                <ContextInputUsage />
                                <ContextOutputUsage />
                                <ContextReasoningUsage />
                                <ContextCacheUsage />
                              </ContextContentBody>
                              <ContextContentFooter className={chrome.contextFooter} />
                            </ContextContent>
                          </Context>

                          <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium text-muted-foreground select-none ${chrome.modelBadge}`}>
                            <ModelSelectorLogo provider={getProviderLogo(aiProvider)} className="size-3" />
                            <ModelSelectorName>{aiModel}</ModelSelectorName>
                          </div>
                        </div>
                      </PromptInputTools>
                      <PromptInputSubmit
                        disabled={isSubmitDisabled}
                        status={status}
                        onStop={onStopStreaming}
                      />
                    </PromptInputFooter>
                  </PromptInput>
                </div>
              </div>
            ) : (
              <div className="h-full overflow-y-auto p-3">
                <div className="flex justify-between items-center px-1 mb-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Chats</h3>
                  {history.length > 0 && (
                    <button onClick={handleClearHistory} className="text-[10px] text-destructive hover:text-destructive/80">
                      Clear All
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {history.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">No history yet</div>
                  ) : (
                    history.map((session) => {
                      const isCurrent = selectedSessionId === session.id;

                      return (
                        <div
                          key={session.id}
                          onClick={() => handleSelectHistory(session)}
                          className={`group p-3.5 rounded-lg transition-all cursor-pointer relative border shadow-lg ${
                            isCurrent ? chrome.historyCardActive : chrome.historyCard
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium ${chrome.accentText}`}>{getSessionType(session)}</span>
                              {isCurrent && (
                                <span className={`flex items-center gap-1 ${chrome.accentBg} ${chrome.accentMuted} text-[9px] px-1.5 py-0.5 rounded-full font-medium`}>
                                  <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${chrome.accentPulseDot}`} />
                                  Current
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground">
                                • {new Date(session.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <button
                              onClick={(e) => handleDeleteHistory(e, session.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/20 rounded text-destructive transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="text-sm line-clamp-2 font-medium mb-0.5">{getSessionLabel(session)}</div>
                          <div className="text-xs text-muted-foreground line-clamp-1">{getSessionPreview(session)}</div>
                          <ChevronRight className="w-3 h-3 text-muted-foreground absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
