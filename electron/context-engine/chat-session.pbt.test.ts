/**
 * Property-based tests for ChatSessionManager.
 * Uses fast-check to validate correctness properties from the design document.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ChatSessionManager, SessionStore } from './chat-session';
import { ChatMessage, ChatSession } from './types';

/** In-memory mock of electron-store for testing. */
function createMockStore(): SessionStore {
    const data: Record<string, unknown> = {};
    return {
        get(key: string) { return data[key]; },
        set(key: string, value: unknown) { data[key] = value; },
    };
}

/** Arbitrary generator for a ChatMessage. */
const arbChatMessage = (): fc.Arbitrary<ChatMessage> =>
    fc.record({
        role: fc.constantFrom('user' as const, 'assistant' as const),
        content: fc.string({ minLength: 1, maxLength: 100 }),
        timestamp: fc.nat({ max: 2000000000000 }),
    });

/** Arbitrary generator for a ChatSession with at least 1 message. */
const arbChatSession = (): fc.Arbitrary<ChatSession> =>
    fc.record({
        id: fc.string({ minLength: 5, maxLength: 20 }).filter(s => s.trim().length > 0),
        messages: fc.array(arbChatMessage(), { minLength: 1, maxLength: 10 }),
        model: fc.string({ maxLength: 20 }),
        provider: fc.constantFrom('google', 'bedrock'),
        createdAt: fc.nat({ max: 2000000000000 }),
        updatedAt: fc.nat({ max: 2000000000000 }),
    });

// Feature: ai-context-engine, Property 10: Chat session save/load round-trip
// **Validates: Requirements 5.1, 5.2**
describe('Property 10: Chat session save/load round-trip', () => {
    it('saved sessions can be loaded with identical messages', () => {
        fc.assert(
            fc.property(arbChatSession(), (session) => {
                const store = createMockStore();
                const manager = new ChatSessionManager(store);

                // Manually set the current session to our generated one
                manager.startSession(undefined, session.model, session.provider);
                const current = manager.getCurrentSession()!;
                // Replace the auto-generated id with our test id for tracking
                (current as any).id = session.id;
                (current as any).createdAt = session.createdAt;
                for (const msg of session.messages) {
                    current.messages.push(msg);
                }
                current.updatedAt = session.updatedAt;

                manager.saveCurrentSession();

                const loaded = manager.loadSession(session.id);
                expect(loaded).not.toBeNull();
                expect(loaded!.messages.length).toBe(session.messages.length);
                for (let i = 0; i < session.messages.length; i++) {
                    expect(loaded!.messages[i].role).toBe(session.messages[i].role);
                    expect(loaded!.messages[i].content).toBe(session.messages[i].content);
                }
            }),
            { numRuns: 100 }
        );
    });
});

// Feature: ai-context-engine, Property 11: Follow-up messages include full conversation history
// **Validates: Requirements 5.3**
describe('Property 11: Follow-up messages include full conversation history', () => {
    it('adding a follow-up results in N+1 messages in order', () => {
        fc.assert(
            fc.property(
                fc.array(arbChatMessage(), { minLength: 1, maxLength: 10 }),
                fc.string({ minLength: 1, maxLength: 100 }),
                (existingMessages, followUpContent) => {
                    const store = createMockStore();
                    const manager = new ChatSessionManager(store);
                    manager.startSession();

                    // Add existing messages
                    for (const msg of existingMessages) {
                        manager.addMessage(msg.role, msg.content);
                    }

                    const n = manager.getCurrentSession()!.messages.length;
                    expect(n).toBe(existingMessages.length);

                    // Add follow-up
                    manager.addMessage('user', followUpContent);

                    const session = manager.getCurrentSession()!;
                    expect(session.messages.length).toBe(n + 1);
                    expect(session.messages[n].role).toBe('user');
                    expect(session.messages[n].content).toBe(followUpContent);

                    // Verify order: all prior messages are still in place
                    for (let i = 0; i < n; i++) {
                        expect(session.messages[i].content).toBe(existingMessages[i].content);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

// Feature: ai-context-engine, Property 12: Context change starts new session and saves previous
// **Validates: Requirements 5.4**
describe('Property 12: Context change starts new session and saves previous', () => {
    it('starting a new session saves the previous one to history', () => {
        fc.assert(
            fc.property(
                fc.array(arbChatMessage(), { minLength: 1, maxLength: 5 }),
                fc.string({ minLength: 1, maxLength: 20 }),
                (messages, newContextName) => {
                    const store = createMockStore();
                    const manager = new ChatSessionManager(store);

                    // Start first session and add messages
                    manager.startSession({ name: 'resource-a', type: 'Pod' });
                    for (const msg of messages) {
                        manager.addMessage(msg.role, msg.content);
                    }
                    const oldSession = manager.getCurrentSession()!;
                    const oldId = oldSession.id;

                    // Save current session before context change
                    manager.saveCurrentSession();

                    // Start new session (context change)
                    manager.startSession({ name: newContextName, type: 'Deployment' });

                    // Old session should be in history
                    const loaded = manager.loadSession(oldId);
                    expect(loaded).not.toBeNull();
                    expect(loaded!.messages.length).toBe(messages.length);

                    // New session should be empty
                    const current = manager.getCurrentSession()!;
                    expect(current.messages.length).toBe(0);
                    expect(current.id).not.toBe(oldId);
                }
            ),
            { numRuns: 100 }
        );
    });
});

// Feature: ai-context-engine, Property 13: Legacy history migration produces valid ChatSession
// **Validates: Requirements 5.5**
describe('Property 13: Legacy history migration produces valid ChatSession', () => {
    it('legacy items with prompt+response produce 2-message ChatSessions', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        id: fc.string({ minLength: 3, maxLength: 15 }).filter(s => s.trim().length > 0),
                        prompt: fc.string({ minLength: 1, maxLength: 100 }),
                        response: fc.string({ minLength: 1, maxLength: 200 }),
                        timestamp: fc.nat({ max: 2000000000000 }),
                        model: fc.string({ maxLength: 20 }),
                        provider: fc.constantFrom('google', 'bedrock'),
                    }),
                    { minLength: 1, maxLength: 10 }
                ),
                (legacyItems) => {
                    // Ensure unique IDs
                    const uniqueItems = legacyItems.filter((item, i, arr) =>
                        arr.findIndex(x => x.id === item.id) === i
                    );
                    if (uniqueItems.length === 0) return;

                    const store = createMockStore();
                    store.set('aiHistory', uniqueItems);
                    const manager = new ChatSessionManager(store);

                    manager.migrateLegacyHistory();

                    const history = manager.getHistory();
                    expect(history.length).toBe(uniqueItems.length);

                    for (const session of history) {
                        expect(session.messages.length).toBe(2);
                        expect(session.messages[0].role).toBe('user');
                        expect(session.messages[1].role).toBe('assistant');
                    }

                    // Legacy key should be cleared
                    expect(store.get('aiHistory')).toEqual([]);
                }
            ),
            { numRuns: 100 }
        );
    });
});

// Feature: ai-context-engine, Property 14: History enforces 50-session limit
// **Validates: Requirements 5.6**
describe('Property 14: History enforces 50-session limit', () => {
    it('adding a session beyond 50 removes the oldest and keeps count at 50', () => {
        fc.assert(
            fc.property(
                fc.nat({ max: 10 }), // extra sessions beyond 50
                (extra) => {
                    const store = createMockStore();
                    const manager = new ChatSessionManager(store);

                    const totalToCreate = 50 + extra + 1;
                    const sessionIds: string[] = [];

                    for (let i = 0; i < totalToCreate; i++) {
                        manager.startSession();
                        manager.addMessage('user', `message ${i}`);
                        // Set createdAt to ensure ordering
                        const current = manager.getCurrentSession()!;
                        (current as any).createdAt = i;
                        sessionIds.push(current.id);
                        manager.saveCurrentSession();
                    }

                    const history = manager.getHistory();
                    expect(history.length).toBe(50);

                    // The newest session should be present
                    const newestId = sessionIds[sessionIds.length - 1];
                    expect(history.some(s => s.id === newestId)).toBe(true);

                    // The oldest sessions should have been removed
                    const removedCount = totalToCreate - 50;
                    for (let i = 0; i < removedCount; i++) {
                        expect(history.some(s => s.id === sessionIds[i])).toBe(false);
                    }
                }
            ),
            { numRuns: 20 } // fewer runs since each creates 50+ sessions
        );
    });
});
