import { watchFile, unwatchFile, type Stats } from 'fs';

export interface KubeconfigWatcherOptions {
    intervalMs?: number;
    debounceMs?: number;
}

/**
 * Watches kubeconfig file(s) for changes and calls `onChange` (debounced).
 *
 * Uses fs.watchFile (stat polling by PATH) rather than fs.watch: editors and tools often replace the
 * file via write-temp-then-rename, which changes the inode and silently kills an inode-based watcher.
 * Path polling survives that and also fires when the file appears or disappears later.
 * The callback is expected to compare content hashes itself, so spurious ticks are harmless.
 */
export class KubeconfigWatcher {
    private readonly intervalMs: number;
    private readonly debounceMs: number;
    private listeners: Map<string, (curr: Stats, prev: Stats) => void> = new Map();
    private debounceTimer: NodeJS.Timeout | null = null;

    constructor(private readonly onChange: () => void, options: KubeconfigWatcherOptions = {}) {
        this.intervalMs = options.intervalMs ?? 1000;
        this.debounceMs = options.debounceMs ?? 400;
    }

    /** Replace the watched file list. Only this watcher's own listeners are removed. */
    setFiles(files: string[]) {
        this.unwatchAll();
        for (const file of files) {
            if (this.listeners.has(file)) continue;
            const listener = (curr: Stats, prev: Stats) => {
                if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size || curr.ino !== prev.ino) {
                    this.schedule();
                }
            };
            watchFile(file, { interval: this.intervalMs, persistent: false }, listener);
            this.listeners.set(file, listener);
        }
    }

    stop() {
        this.unwatchAll();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private unwatchAll() {
        for (const [file, listener] of this.listeners) {
            unwatchFile(file, listener);
        }
        this.listeners.clear();
    }

    private schedule() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            try {
                this.onChange();
            } catch (err) {
                console.error('[kubeconfig-watcher] onChange failed:', err);
            }
        }, this.debounceMs);
    }
}
