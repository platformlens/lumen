/**
 * ChatSessionManager — manages chat sessions with clean persistence.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { ChatMessage, ChatSession } from './types';

const MAX_SESSIONS = 50;
const SESSIONS_KEY = 'aiChatSessions';
const LEGACY_KEY = 'aiHistory';

/** Minimal interface for electron-store (avoids importing the full module in tests). */
export interface SessionStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
}

export class ChatSessionManager {
    private currentSession: ChatSession | null = null;
    private store: SessionStore;

    constructor(store: SessionStore) {
        this.store = store;
    }

    /** Start a new chat session, optionally with resource context. */
    startSession(context?: { name: string; type: string; namespace?: string }, model = '', provider = ''): ChatSession {
        const session: ChatSession = {
            id: this.generateId(),
            messages: [],
            resourceContext: context,
            model,
            provider,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.currentSession = session;
        return session;
    }

    /** Add a message to the current session. */
    addMessage(role: 'user' | 'assistant', content: string): void {
        if (!this.currentSession) return;
        const msg: ChatMessage = { role, content, timestamp: Date.now() };
        this.currentSession.messages.push(msg);
        this.currentSession.updatedAt = Date.now();
    }

    /** Get the current active session. */
    getCurrentSession(): ChatSession | null {
        return this.currentSession;
    }

    /** Persist the current session to the history store. */
    saveCurrentSession(): void {
        if (!this.currentSession || this.currentSession.messages.length === 0) return;
        const sessions = this.readSessions();
        // Remove existing session with same id if re-saving
        const filtered = sessions.filter(s => s.id !== this.currentSession!.id);
        filtered.unshift(this.currentSession);
        this.enforceLimitAndSave(filtered);
    }

    /** Get all saved sessions (newest first). */
    getHistory(): ChatSession[] {
        return this.readSessions();
    }

    /** Load a specific session by ID. */
    loadSession(id: string): ChatSession | null {
        const sessions = this.readSessions();
        return sessions.find(s => s.id === id) ?? null;
    }

    /** Delete a session by ID. */
    deleteSession(id: string): void {
        const sessions = this.readSessions();
        const filtered = sessions.filter(s => s.id !== id);
        this.store.set(SESSIONS_KEY, filtered);
    }

    /** Clear all saved sessions. */
    clearHistory(): void {
        this.store.set(SESSIONS_KEY, []);
    }

    /**
     * Migrate legacy aiHistory items to ChatSession format.
     * Legacy items have { id, prompt, response, timestamp, model, provider, resourceName, resourceType, conversation? }.
     */
    migrateLegacyHistory(): void {
        const legacy = this.store.get(LEGACY_KEY) as any[] | undefined;
        if (!legacy || !Array.isArray(legacy) || legacy.length === 0) return;

        const existing = this.readSessions();
        const existingIds = new Set(existing.map(s => s.id));

        const migrated: ChatSession[] = [];
        for (const item of legacy) {
            if (!item || existingIds.has(item.id)) continue;

            const messages: ChatMessage[] = [];
            if (item.conversation && Array.isArray(item.conversation)) {
                // Has full conversation array
                for (const msg of item.conversation) {
                    messages.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: String(msg.content ?? ''),
                        timestamp: item.timestamp ?? Date.now(),
                    });
                }
            } else {
                // Legacy format: just prompt + response
                if (item.prompt) {
                    messages.push({ role: 'user', content: String(item.prompt), timestamp: item.timestamp ?? Date.now() });
                }
                if (item.response) {
                    messages.push({ role: 'assistant', content: String(item.response), timestamp: item.timestamp ?? Date.now() });
                }
            }

            if (messages.length === 0) continue;

            migrated.push({
                id: item.id ?? this.generateId(),
                messages,
                resourceContext: item.resourceName ? { name: item.resourceName, type: item.resourceType ?? 'Unknown' } : undefined,
                model: item.model ?? '',
                provider: item.provider ?? '',
                createdAt: item.timestamp ?? Date.now(),
                updatedAt: item.timestamp ?? Date.now(),
            });
        }

        if (migrated.length > 0) {
            const combined = [...existing, ...migrated];
            this.enforceLimitAndSave(combined);
        }

        // Clear legacy key after migration
        this.store.set(LEGACY_KEY, []);
    }

    // --- Private helpers ---

    private readSessions(): ChatSession[] {
        const data = this.store.get(SESSIONS_KEY);
        if (!Array.isArray(data)) return [];
        return data as ChatSession[];
    }

    private enforceLimitAndSave(sessions: ChatSession[]): void {
        if (sessions.length > MAX_SESSIONS) {
            // Sort by createdAt descending, keep newest MAX_SESSIONS
            sessions.sort((a, b) => b.createdAt - a.createdAt);
            sessions.splice(MAX_SESSIONS);
        }
        this.store.set(SESSIONS_KEY, sessions);
    }

    private generateId(): string {
        return 'sess_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    }
}
