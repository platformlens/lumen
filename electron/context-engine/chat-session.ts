/**
 * ChatSessionManager — manages chat sessions with encrypted persistence.
 * Requirements: 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { ChatMessage, ChatSession } from './types';

const MAX_SESSIONS = 50;
const ENCRYPTED_SESSIONS_KEY = 'aiChatSessions_encrypted';
const LEGACY_KEY = 'aiHistory';

/** Minimal interface for EncryptedStore (avoids importing the full module in tests). */
export interface EncryptedSessionStore {
    encryptAndStore(key: string, data: unknown): void;
    decryptAndRetrieve<T = unknown>(key: string): T | null;
}

/** Minimal interface for electron-store used only during legacy migration. */
export interface LegacySessionStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
}

/** Options for constructing a ChatSessionManager. */
export interface ChatSessionManagerOptions {
    /** The encrypted store backend for reading/writing sessions. */
    encryptedStore: EncryptedSessionStore;
    /** Optional legacy store for migration of old aiHistory data. */
    legacyStore?: LegacySessionStore;
    /** Getter that returns whether AI history persistence is enabled. Defaults to () => true. */
    isHistoryEnabled?: () => boolean;
}

export class ChatSessionManager {
    private currentSession: ChatSession | null = null;
    private encryptedStore: EncryptedSessionStore;
    private legacyStore: LegacySessionStore | undefined;
    private isHistoryEnabled: () => boolean;

    constructor(options: ChatSessionManagerOptions) {
        this.encryptedStore = options.encryptedStore;
        this.legacyStore = options.legacyStore;
        this.isHistoryEnabled = options.isHistoryEnabled ?? (() => true);
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

    /** Persist the current session to the history store. Skips if AI history is disabled. */
    saveCurrentSession(): void {
        if (!this.currentSession || this.currentSession.messages.length === 0) return;
        if (!this.isHistoryEnabled()) return;
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

    /** Load a specific session by ID (read-only; does not change the active session). */
    loadSession(id: string): ChatSession | null {
        const sessions = this.readSessions();
        const found = sessions.find(s => s.id === id);
        if (!found) return null;
        return this.cloneSession(found);
    }

    /**
     * Make a session the active one so follow-up messages append and save updates the same history entry.
     * Returns a deep copy of the stored session, or null if the id is missing.
     */
    resumeSession(id: string): ChatSession | null {
        const stored = this.readSessions().find(s => s.id === id);
        if (!stored) return null;
        this.currentSession = this.cloneSession(stored);
        return this.currentSession;
    }

    private cloneSession(session: ChatSession): ChatSession {
        return {
            ...session,
            messages: session.messages.map(m => ({ ...m })),
            resourceContext: session.resourceContext
                ? { ...session.resourceContext }
                : undefined,
        };
    }

    /** Delete a session by ID. Skips if AI history is disabled. */
    deleteSession(id: string): void {
        if (!this.isHistoryEnabled()) return;
        const sessions = this.readSessions();
        const filtered = sessions.filter(s => s.id !== id);
        this.encryptedStore.encryptAndStore(ENCRYPTED_SESSIONS_KEY, filtered);
    }

    /** Clear all saved sessions. Skips if AI history is disabled. */
    clearHistory(): void {
        if (!this.isHistoryEnabled()) return;
        this.encryptedStore.encryptAndStore(ENCRYPTED_SESSIONS_KEY, []);
    }

    /**
     * Migrate legacy aiHistory items to ChatSession format.
     * Legacy items have { id, prompt, response, timestamp, model, provider, resourceName, resourceType, conversation? }.
     * Requires a legacyStore to be provided in the constructor options.
     */
    migrateLegacyHistory(): void {
        if (!this.legacyStore) return;
        const legacy = this.legacyStore.get(LEGACY_KEY) as any[] | undefined;
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
        this.legacyStore.set(LEGACY_KEY, []);
    }

    // --- Private helpers ---

    private readSessions(): ChatSession[] {
        const data = this.encryptedStore.decryptAndRetrieve<ChatSession[]>(ENCRYPTED_SESSIONS_KEY);
        if (!Array.isArray(data)) return [];
        return data;
    }

    private enforceLimitAndSave(sessions: ChatSession[]): void {
        if (sessions.length > MAX_SESSIONS) {
            // Sort by createdAt descending, keep newest MAX_SESSIONS
            sessions.sort((a, b) => b.createdAt - a.createdAt);
            sessions.splice(MAX_SESSIONS);
        }
        this.encryptedStore.encryptAndStore(ENCRYPTED_SESSIONS_KEY, sessions);
    }

    private generateId(): string {
        return 'sess_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    }
}
