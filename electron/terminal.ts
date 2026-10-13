import * as pty from 'node-pty';

import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildContextKubeconfig, buildKubeconfigEnv, isValidTerminalContext } from './terminal-kubeconfig';

const MAX_TERMINAL_ID_LENGTH = 128;
const MAX_WRITE_PAYLOAD_BYTES = 64 * 1024; // 64 KB

/**
 * Feature gate for local terminal creation.
 * When disabled, createTerminal will reject with an error.
 * Defaults to true (enabled). Main process sets this based on
 * the `settings_enableLocalTerminal` store value.
 */
let localTerminalEnabled = true;

/**
 * Sets the local terminal feature gate.
 * Called by main.ts to sync with the electron-store setting.
 */
export function setLocalTerminalEnabled(enabled: boolean): void {
    localTerminalEnabled = enabled;
}

/**
 * Returns the current state of the local terminal feature gate.
 */
export function getLocalTerminalEnabled(): boolean {
    return localTerminalEnabled;
}

/**
 * Allowed environment variable keys for terminal processes.
 * Only these keys are forwarded from process.env to spawned PTY processes
 * to prevent leaking sensitive environment variables (credentials, tokens, etc.).
 */
const ALLOWED_ENV_KEYS = [
    'PATH',
    'HOME',
    'SHELL',
    'TERM',
    'LANG',
    'USER',
    'LOGNAME',
    'KUBECONFIG',
    'TMPDIR',
] as const;

/**
 * Returns a sanitized copy of process.env containing only the allowed keys.
 * This prevents leaking sensitive environment variables (AWS credentials, API keys, etc.)
 * to spawned terminal processes.
 */
export function sanitizedEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of ALLOWED_ENV_KEYS) {
        const value = process.env[key];
        if (value !== undefined) {
            env[key] = value;
        }
    }
    return env;
}

/**
 * Validates a Kubernetes name/identifier.
 * Allows alphanumeric, hyphens, underscores, dots, forward slashes.
 * Max 253 characters. Rejects '..' and '//' sequences.
 */
export function validateK8sName(name: string): void {
    if (!name || name.length === 0) {
        throw new Error('Kubernetes name must not be empty');
    }
    if (name.length > 253) {
        throw new Error(`Kubernetes name exceeds maximum length of 253 characters: ${name.length} characters`);
    }
    if (name.includes('..')) {
        throw new Error(`Kubernetes name must not contain '..' sequence: ${name}`);
    }
    if (name.includes('//')) {
        throw new Error(`Kubernetes name must not contain '//' sequence: ${name}`);
    }
    // Allow alphanumeric, hyphens, underscores, dots, forward slashes
    const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9._/\-]*$/;
    if (!validPattern.test(name)) {
        throw new Error(`Kubernetes name contains invalid characters: ${name}`);
    }
}

/** Maximum number of concurrent PTY sessions across all windows. */
const MAX_TERMINALS = 32;

interface PtySession {
    pty: pty.IPty;
    /** webContents id of the renderer that owns this session */
    ownerId: number;
    /** Per-terminal override kubeconfig (only for context-bound local terminals) */
    kubeconfigFile?: string;
    /** Kube context this terminal is bound to (only for context-bound local terminals) */
    context?: string;
}

export class TerminalService {
    private sessions: Map<string, PtySession> = new Map();
    private trackedSenders: Set<number> = new Set();
    private kubeconfigDir: string | null = null;

    /**
     * Spawns a local login shell. When `context` is given, the shell is bound to that
     * kube context through a per-terminal override kubeconfig prepended to KUBECONFIG,
     * so the user's global kubeconfig current-context is never modified.
     */
    createTerminal(sender: Electron.WebContents, id: string, cols: number, rows: number, context?: string) {
        // Feature gate: reject local terminal creation when disabled
        if (!localTerminalEnabled) {
            throw new Error('Local terminals are disabled');
        }

        this.assertCanCreate(id);

        if (context !== undefined && !isValidTerminalContext(context)) {
            throw new Error('Invalid kube context for terminal');
        }

        this.replaceExisting(id);

        let shell = process.env[os.platform() === 'win32' ? 'COMSPEC' : 'SHELL'];

        if (!shell && os.platform() === 'darwin') {
            shell = '/bin/zsh';
        } else if (!shell) {
            shell = '/bin/bash';
        }

        console.log(`[Terminal] Process Arch: ${process.arch}, Selected Shell: ${shell}`);

        // Use user's home directory as CWD
        const cwd = os.homedir();

        const env = sanitizedEnv();
        let kubeconfigFile: string | undefined;

        try {
            if (context !== undefined) {
                kubeconfigFile = this.writeContextKubeconfig(context);
                env.KUBECONFIG = buildKubeconfigEnv(kubeconfigFile, process.env.KUBECONFIG, os.homedir(), path.delimiter);
                env.LUMEN_KUBE_CONTEXT = context;
            }

            const args = os.platform() === 'win32' ? [] : ['--login'];
            const ptyProcess = pty.spawn(shell, args, {
                name: 'xterm-256color',
                cols: cols || 80,
                rows: rows || 24,
                cwd: cwd,
                env,
            });

            this.attach(sender, id, ptyProcess, kubeconfigFile, context);
            return true;
        } catch (error) {
            removeFileQuietly(kubeconfigFile);
            console.error('Failed to spawn terminal:', error);
            throw error;
        }
    }

    createExecTerminal(sender: Electron.WebContents, id: string, cols: number, rows: number, context: string, namespace: string, podName: string, containerName?: string) {
        this.assertCanCreate(id);

        // Validate all Kubernetes parameters before spawning
        validateK8sName(context);
        validateK8sName(namespace);
        validateK8sName(podName);
        if (containerName) {
            validateK8sName(containerName);
        }

        this.replaceExisting(id);

        const cwd = os.homedir();

        try {
            // Build argument array for kubectl exec — no shell interpretation
            const args = ['exec', '-it', '--context', context, '-n', namespace, podName];
            if (containerName) {
                args.push('-c', containerName);
            }
            args.push('--', '/bin/sh');

            console.log(`[Terminal] Spawning kubectl with args:`, args);

            // Spawn kubectl directly with argument array — eliminates shell injection
            const ptyProcess = pty.spawn('kubectl', args, {
                name: 'xterm-256color',
                cols: cols || 80,
                rows: rows || 24,
                cwd: cwd,
                env: sanitizedEnv(),
            });

            this.attach(sender, id, ptyProcess);
            return true;
        } catch (error) {
            console.error('Failed to spawn exec terminal:', error);
            throw error;
        }
    }

    write(id: string, data: string) {
        // Enforce maximum write payload size (64 KB)
        if (Buffer.byteLength(data, 'utf8') > MAX_WRITE_PAYLOAD_BYTES) {
            console.warn(`[Terminal] Write payload exceeds maximum size of 64 KB for terminal ${id}`);
            throw new Error(`Write payload exceeds maximum size of ${MAX_WRITE_PAYLOAD_BYTES} bytes`);
        }

        const session = this.sessions.get(id);
        if (session) {
            session.pty.write(data);
        } else {
            console.warn(`TerminalService: Write failed - terminal ${id} not found. Available:`, Array.from(this.sessions.keys()));
        }
    }

    resize(id: string, cols: number, rows: number) {
        const session = this.sessions.get(id);
        if (session) {
            try {
                session.pty.resize(cols, rows);
            } catch {
                // suppress resize errors if process is dying
            }
        }
    }

    dispose(id: string) {
        const session = this.sessions.get(id);
        if (session) {
            this.sessions.delete(id);
            this.killSession(session);
        }
    }

    /** Kills every PTY owned by a renderer (called when its webContents is destroyed). */
    disposeForSender(senderId: number) {
        for (const [id, session] of this.sessions) {
            if (session.ownerId === senderId) {
                this.sessions.delete(id);
                this.killSession(session);
            }
        }
    }

    /**
     * After a kube context rename, points context-bound terminals at the new name by rewriting their
     * override kubeconfig (kubectl re-reads it on every invocation). Returns the number of terminals updated.
     */
    retargetContext(oldCtx: string, newCtx: string): number {
        if (!isValidTerminalContext(newCtx)) return 0;
        let updated = 0;
        for (const session of this.sessions.values()) {
            if (session.context !== oldCtx || !session.kubeconfigFile) continue;
            try {
                fs.writeFileSync(session.kubeconfigFile, buildContextKubeconfig(newCtx), { mode: 0o600 });
                session.context = newCtx;
                updated++;
            } catch (err) {
                console.warn('[Terminal] Failed to retarget terminal kubeconfig:', err);
            }
        }
        return updated;
    }

    /** Kills every PTY and removes all override kubeconfig files (window close / app quit). */
    disposeAll() {
        for (const session of this.sessions.values()) {
            this.killSession(session);
        }
        this.sessions.clear();
        if (this.kubeconfigDir) {
            try {
                fs.rmSync(this.kubeconfigDir, { recursive: true, force: true });
            } catch (err) {
                console.warn('[Terminal] Failed to remove kubeconfig temp dir:', err);
            }
            this.kubeconfigDir = null;
        }
    }

    private assertCanCreate(id: string) {
        // Enforce terminal ID length
        if (id.length === 0 || id.length > MAX_TERMINAL_ID_LENGTH) {
            throw new Error(`Terminal ID must be 1-${MAX_TERMINAL_ID_LENGTH} characters`);
        }
        if (!this.sessions.has(id) && this.sessions.size >= MAX_TERMINALS) {
            throw new Error(`Too many open terminals (maximum ${MAX_TERMINALS}). Close one and try again.`);
        }
    }

    /** If a session with this id already exists, kill it before re-creating. */
    private replaceExisting(id: string) {
        const existing = this.sessions.get(id);
        if (existing) {
            this.sessions.delete(id);
            this.killSession(existing);
        }
    }

    private killSession(session: PtySession) {
        try {
            session.pty.kill();
        } catch {
            // process may already have exited
        }
        removeFileQuietly(session.kubeconfigFile);
    }

    /** Wires PTY output/exit to the owning renderer only, scoped by terminal id. */
    private attach(sender: Electron.WebContents, id: string, ptyProcess: pty.IPty, kubeconfigFile?: string, context?: string) {
        const ownerId = sender.id;
        this.sessions.set(id, { pty: ptyProcess, ownerId, kubeconfigFile, context });
        this.trackSender(sender);

        ptyProcess.onData((data) => {
            if (!sender.isDestroyed()) {
                sender.send('terminal:data', id, data);
            }
        });

        ptyProcess.onExit(({ exitCode }) => {
            if (!sender.isDestroyed()) {
                sender.send('terminal:exit', id, exitCode);
            }
            // Only drop the entry if it still belongs to this PTY (it may have been replaced)
            if (this.sessions.get(id)?.pty === ptyProcess) {
                this.sessions.delete(id);
            }
            removeFileQuietly(kubeconfigFile);
        });
    }

    /** Kill a renderer's PTYs when its webContents is destroyed (window closed). */
    private trackSender(sender: Electron.WebContents) {
        const senderId = sender.id;
        if (this.trackedSenders.has(senderId)) return;
        this.trackedSenders.add(senderId);
        sender.once('destroyed', () => {
            this.trackedSenders.delete(senderId);
            this.disposeForSender(senderId);
        });
    }

    /** Writes a 0600 override kubeconfig that only sets current-context. */
    private writeContextKubeconfig(context: string): string {
        if (!this.kubeconfigDir || !fs.existsSync(this.kubeconfigDir)) {
            // mkdtemp creates the directory with mode 0700
            this.kubeconfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-kube-'));
        }
        const file = path.join(this.kubeconfigDir, `term-${crypto.randomUUID()}.yaml`);
        fs.writeFileSync(file, buildContextKubeconfig(context), { mode: 0o600 });
        return file;
    }
}

function removeFileQuietly(file: string | undefined) {
    if (!file) return;
    try {
        fs.rmSync(file, { force: true });
    } catch {
        // best-effort cleanup
    }
}
