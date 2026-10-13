/**
 * Secret Store — wraps keytar for OS-backed secret storage with migration
 * from plaintext electron-store.
 *
 * - Uses the OS keychain (macOS Keychain, Windows Credential Vault, Linux libsecret)
 * - Service name: "lumen"
 * - Falls back to electron-store if keytar is unavailable
 * - Provides migration from legacy plaintext storage
 * - Includes a masking helper for displaying secret previews
 */

import { getAuditLogger } from './audit-logger';

// --- Types ---

export type SecretKey =
  | 'geminiApiKey'
  | 'awsAccessKeyId'
  | 'awsSecretAccessKey'
  | 'awsSessionToken';

/**
 * Minimal interface for the electron-store instance used in migration.
 * Allows the store to be passed without importing the full electron-store type.
 */
export interface ElectronStoreCompat {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  has(key: string): boolean;
}

// --- Constants ---

const SERVICE_NAME = 'lumen';

/**
 * Maps SecretKey to the legacy electron-store key and field path.
 * - geminiApiKey: stored directly as `geminiApiKey` string
 * - AWS keys: stored inside `awsCreds` object with specific field names
 */
const LEGACY_KEY_MAP: Record<SecretKey, { storeKey: string; field?: string }> = {
  geminiApiKey: { storeKey: 'geminiApiKey' },
  awsAccessKeyId: { storeKey: 'awsCreds', field: 'accessKeyId' },
  awsSecretAccessKey: { storeKey: 'awsCreds', field: 'secretAccessKey' },
  awsSessionToken: { storeKey: 'awsCreds', field: 'sessionToken' },
};

// --- Masking Helper ---

/**
 * Mask a secret string for display purposes.
 * - For strings ≥ 8 chars: show first 4 + asterisks + last 4
 * - For strings shorter than 8: replace entirely with asterisks
 */
export function maskSecret(value: string): string {
  if (value.length >= 8) {
    const first4 = value.slice(0, 4);
    const last4 = value.slice(-4);
    const middleLength = value.length - 8;
    return `${first4}${'*'.repeat(middleLength)}${last4}`;
  }
  return '*'.repeat(value.length);
}

// --- Keytar dynamic import ---

interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let keytarModule: KeytarModule | null = null;
let keytarLoadAttempted = false;

async function loadKeytar(): Promise<KeytarModule | null> {
  if (keytarLoadAttempted) return keytarModule;
  keytarLoadAttempted = true;

  try {
    // Dynamic import — keytar may not be available on all platforms
    // @ts-ignore — keytar is an optional native dependency without bundled types
    keytarModule = (await import('keytar')) as unknown as KeytarModule;
    return keytarModule;
  } catch {
    keytarModule = null;
    return null;
  }
}

// --- SecretStore Class ---

export class SecretStore {
  private fallbackStore: ElectronStoreCompat | null = null;
  private available: boolean | null = null;

  /**
   * Check if keytar is available on this platform.
   * Caches the result after the first check.
   */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;

    const keytar = await loadKeytar();
    if (!keytar) {
      this.available = false;
      return false;
    }

    // Verify keytar actually works by attempting a test operation
    try {
      await keytar.getPassword(SERVICE_NAME, '__availability_check__');
      this.available = true;
    } catch {
      this.available = false;
    }

    return this.available;
  }

  /**
   * Store a secret in the OS keychain.
   * Falls back to electron-store if keytar is unavailable.
   * Returns true on success, false on failure.
   */
  async setSecret(key: SecretKey, value: string): Promise<boolean> {
    if (await this.isAvailable()) {
      try {
        const keytar = (await loadKeytar())!;
        await keytar.setPassword(SERVICE_NAME, key, value);
        return true;
      } catch (err) {
        const logger = getAuditLogger();
        logger.log({
          action: 'secretStore:setSecret',
          category: 'SECURITY',
          result: `Failed to store secret "${key}": ${err instanceof Error ? err.message : 'unknown error'}`,
        });
        return false;
      }
    }

    // Fallback to electron-store
    if (this.fallbackStore) {
      try {
        this.fallbackStore.set(`_secret_${key}`, value);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Retrieve a secret from the OS keychain.
   * Falls back to electron-store if keytar is unavailable.
   * Returns null if not found.
   */
  async getSecret(key: SecretKey): Promise<string | null> {
    if (await this.isAvailable()) {
      try {
        const keytar = (await loadKeytar())!;
        return await keytar.getPassword(SERVICE_NAME, key);
      } catch (err) {
        const logger = getAuditLogger();
        logger.log({
          action: 'secretStore:getSecret',
          category: 'SECURITY',
          result: `Failed to retrieve secret "${key}": ${err instanceof Error ? err.message : 'unknown error'}`,
        });
        return null;
      }
    }

    // Fallback to electron-store
    if (this.fallbackStore) {
      const value = this.fallbackStore.get(`_secret_${key}`);
      return typeof value === 'string' ? value : null;
    }

    return null;
  }

  /**
   * Delete a secret from the OS keychain.
   * Falls back to electron-store if keytar is unavailable.
   */
  async deleteSecret(key: SecretKey): Promise<void> {
    if (await this.isAvailable()) {
      try {
        const keytar = (await loadKeytar())!;
        await keytar.deletePassword(SERVICE_NAME, key);
      } catch (err) {
        const logger = getAuditLogger();
        logger.log({
          action: 'secretStore:deleteSecret',
          category: 'SECURITY',
          result: `Failed to delete secret "${key}": ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
      return;
    }

    // Fallback to electron-store
    if (this.fallbackStore) {
      this.fallbackStore.delete(`_secret_${key}`);
    }
  }

  /**
   * Migrate plaintext secrets from electron-store to keytar.
   *
   * Migration flow:
   * 1. For each SecretKey, read from electron-store (legacy keys)
   * 2. If a value exists, write it to keytar via setSecret
   * 3. Verify the round-trip by calling getSecret and comparing
   * 4. Only after verification, delete the plaintext entry from electron-store
   * 5. If keytar is unavailable, log a warning and skip migration
   */
  async migrateLegacySecrets(store: ElectronStoreCompat): Promise<void> {
    // Store reference for fallback use
    this.fallbackStore = store;

    const logger = getAuditLogger();

    if (!(await this.isAvailable())) {
      logger.log({
        action: 'secretStore:migrateLegacySecrets',
        category: 'SECURITY',
        result: 'Keytar unavailable — skipping migration. Secrets remain in plaintext electron-store.',
      });
      return;
    }

    const secretKeys: SecretKey[] = [
      'geminiApiKey',
      'awsAccessKeyId',
      'awsSecretAccessKey',
      'awsSessionToken',
    ];

    for (const secretKey of secretKeys) {
      const mapping = LEGACY_KEY_MAP[secretKey];
      const rawValue = store.get(mapping.storeKey);

      let value: string | undefined;

      if (mapping.field) {
        // AWS credentials are stored as an object
        if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
          const fieldValue = (rawValue as Record<string, unknown>)[mapping.field];
          if (typeof fieldValue === 'string' && fieldValue.length > 0) {
            value = fieldValue;
          }
        }
      } else {
        // Direct string value (e.g., geminiApiKey)
        if (typeof rawValue === 'string' && rawValue.length > 0) {
          value = rawValue;
        }
      }

      if (!value) continue;

      // Write to keytar
      const writeSuccess = await this.setSecret(secretKey, value);
      if (!writeSuccess) {
        logger.log({
          action: 'secretStore:migrateLegacySecrets',
          category: 'SECURITY',
          resourceName: secretKey,
          result: `Failed to write secret "${secretKey}" to keytar — skipping deletion of plaintext.`,
        });
        continue;
      }

      // Verify round-trip
      const readBack = await this.getSecret(secretKey);
      if (readBack !== value) {
        logger.log({
          action: 'secretStore:migrateLegacySecrets',
          category: 'SECURITY',
          resourceName: secretKey,
          result: `Round-trip verification failed for "${secretKey}" — skipping deletion of plaintext.`,
        });
        continue;
      }

      // Delete plaintext from electron-store
      if (mapping.field) {
        // For AWS creds, remove the specific field from the object
        const currentObj = store.get(mapping.storeKey);
        if (currentObj && typeof currentObj === 'object' && !Array.isArray(currentObj)) {
          const updated = { ...(currentObj as Record<string, unknown>) };
          delete updated[mapping.field];

          // If the object is now empty, delete the entire key
          if (Object.keys(updated).length === 0) {
            store.delete(mapping.storeKey);
          } else {
            store.set(mapping.storeKey, updated);
          }
        }
      } else {
        store.delete(mapping.storeKey);
      }

      logger.log({
        action: 'secretStore:migrateLegacySecrets',
        category: 'SECURITY',
        resourceName: secretKey,
        result: `Successfully migrated "${secretKey}" to OS keychain and removed plaintext.`,
      });
    }
  }
}

// --- Singleton ---

let _instance: SecretStore | null = null;

/**
 * Get the singleton SecretStore instance.
 */
export function getSecretStore(): SecretStore {
  if (!_instance) {
    _instance = new SecretStore();
  }
  return _instance;
}
