/**
 * Encrypted Store — uses Electron's safeStorage API to encrypt larger data blobs at rest.
 *
 * - Encrypts data using safeStorage.encryptString() and stores as base64 in electron-store
 * - Decrypts by reading base64, decoding to Buffer, and passing to safeStorage.decryptString()
 * - Falls back to unencrypted electron-store if safeStorage is unavailable
 * - Handles corrupted data and JSON parse failures gracefully (returns null, logs error)
 * - Migrates plaintext aiChatSessions to encrypted aiChatSessions_encrypted
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import { safeStorage } from 'electron';
import { getAuditLogger } from './audit-logger';

// --- Interfaces ---

/** Minimal interface for electron-store (avoids importing the full module). */
export interface ElectronStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  has(key: string): boolean;
}

// --- Constants ---

const LEGACY_SESSIONS_KEY = 'aiChatSessions';
const ENCRYPTED_SESSIONS_KEY = 'aiChatSessions_encrypted';

// --- EncryptedStore Class ---

export class EncryptedStore {
  private store: ElectronStore;

  constructor(store: ElectronStore) {
    this.store = store;
  }

  /**
   * Check if safeStorage encryption is available on this platform.
   */
  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Encrypt data and persist to electron-store under the given key.
   * Serializes to JSON, encrypts with safeStorage.encryptString(), stores as base64.
   * Falls back to unencrypted storage if safeStorage is unavailable.
   */
  encryptAndStore(key: string, data: unknown): void {
    try {
      const json = JSON.stringify(data);

      if (this.isAvailable()) {
        const encrypted = safeStorage.encryptString(json);
        const base64 = encrypted.toString('base64');
        this.store.set(key, base64);
      } else {
        // Fallback: store unencrypted with a warning
        const logger = getAuditLogger();
        logger.log({
          action: 'encryptedStore:fallbackToPlaintext',
          category: 'SECURITY',
          result: `safeStorage unavailable — storing key "${key}" without encryption`,
        });
        this.store.set(key, json);
      }
    } catch (err: unknown) {
      const logger = getAuditLogger();
      const message = err instanceof Error ? err.message : String(err);
      logger.log({
        action: 'encryptedStore:encryptAndStore',
        category: 'SECURITY',
        result: `Failed to encrypt and store key "${key}": ${message}`,
      });
    }
  }

  /**
   * Decrypt and deserialize data from electron-store.
   * Reads base64 from store, decodes to Buffer, decrypts with safeStorage.decryptString(), parses JSON.
   * Returns null if not found, corrupted, or decryption/parse fails.
   */
  decryptAndRetrieve<T = unknown>(key: string): T | null {
    try {
      const stored = this.store.get(key);
      if (stored === undefined || stored === null) {
        return null;
      }

      if (typeof stored !== 'string') {
        // Data is not in expected string format
        const logger = getAuditLogger();
        logger.log({
          action: 'encryptedStore:decryptAndRetrieve',
          category: 'SECURITY',
          result: `Unexpected data type for key "${key}": expected string, got ${typeof stored}`,
        });
        return null;
      }

      let json: string;

      if (this.isAvailable()) {
        // Decode base64 to Buffer and decrypt
        const buffer = Buffer.from(stored, 'base64');
        json = safeStorage.decryptString(buffer);
      } else {
        // Fallback: data was stored as plain JSON string
        json = stored;
      }

      return JSON.parse(json) as T;
    } catch (err: unknown) {
      const logger = getAuditLogger();
      const message = err instanceof Error ? err.message : String(err);
      logger.log({
        action: 'encryptedStore:decryptAndRetrieve',
        category: 'SECURITY',
        result: `Failed to decrypt/parse key "${key}": ${message}`,
      });
      return null;
    }
  }

  /**
   * Migrate plaintext aiChatSessions to encrypted storage.
   * Reads from the legacy key, encrypts, stores under the encrypted key,
   * then removes the plaintext entry.
   * If safeStorage is unavailable, logs a warning and skips migration.
   */
  migratePlaintextSessions(store: ElectronStore): void {
    try {
      // Check if there's plaintext data to migrate
      if (!store.has(LEGACY_SESSIONS_KEY)) {
        return;
      }

      const plaintext = store.get(LEGACY_SESSIONS_KEY);
      if (plaintext === undefined || plaintext === null) {
        return;
      }

      // Skip if already migrated (encrypted key exists)
      if (store.has(ENCRYPTED_SESSIONS_KEY)) {
        return;
      }

      if (!this.isAvailable()) {
        const logger = getAuditLogger();
        logger.log({
          action: 'encryptedStore:migratePlaintextSessions',
          category: 'SECURITY',
          result: 'safeStorage unavailable — skipping session migration. Credentials stored without OS-level encryption.',
        });
        return;
      }

      // Encrypt and store under the new key
      this.encryptAndStore(ENCRYPTED_SESSIONS_KEY, plaintext);

      // Verify the migration succeeded by reading back
      const verified = this.decryptAndRetrieve(ENCRYPTED_SESSIONS_KEY);
      if (verified !== null) {
        // Migration successful — remove plaintext
        store.delete(LEGACY_SESSIONS_KEY);
      } else {
        const logger = getAuditLogger();
        logger.log({
          action: 'encryptedStore:migratePlaintextSessions',
          category: 'SECURITY',
          result: 'Migration verification failed — plaintext sessions preserved for retry on next startup',
        });
      }
    } catch (err: unknown) {
      const logger = getAuditLogger();
      const message = err instanceof Error ? err.message : String(err);
      logger.log({
        action: 'encryptedStore:migratePlaintextSessions',
        category: 'SECURITY',
        result: `Session migration failed: ${message}`,
      });
    }
  }
}
