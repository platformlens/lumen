import * as pty from 'node-pty';

import os from 'os';

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

export class TerminalService {
    private ptyProcesses: Map<string, pty.IPty> = new Map();

    constructor() {
        this.registerHandlers();
    }

    private registerHandlers() {
        // We'll rely on calling these methods from main.ts or registering additional handlers here.
        // Actually, following the pattern in main.ts, main.ts registers the handlers calling service methods.
        // So I will just expose public methods.
    }

    createTerminal(sender: Electron.WebContents, id: string, cols: number, rows: number) {
        // Feature gate: reject local terminal creation when disabled
        if (!localTerminalEnabled) {
            throw new Error('Local terminals are disabled');
        }

        // Enforce terminal ID length
        if (id.length > MAX_TERMINAL_ID_LENGTH) {
            throw new Error(`Terminal ID exceeds maximum length of ${MAX_TERMINAL_ID_LENGTH} characters`);
        }

        if (this.ptyProcesses.has(id)) {
            // If it exists, maybe we just didn't clean it up? Or user wants to reconnect?
            // For now, let's kill the old one to be safe.
            this.ptyProcesses.get(id)?.kill();
        }

        let shell = process.env[os.platform() === 'win32' ? 'COMSPEC' : 'SHELL'];

        if (!shell && os.platform() === 'darwin') {
            shell = '/bin/zsh';
        } else if (!shell) {
            shell = '/bin/bash';
        }

        console.log(`[Terminal] Debug Info:`);
        console.log(`[Terminal] Process Arch: ${process.arch}`);
        console.log(`[Terminal] Selected Shell: ${shell}`);

        // Debug shell existence
        try {
            // Basic sync check since we are in a class method, imports are top level usually but we can require or just use fs if imported.
            // 'fs' is not imported, let's fix that in next step or assume it fails silently if not. 
            // Actually, I to be safe I will just Log. 
            // Wait, I can import fs in the file header if I view it again? No, I'll use dynamic require or similar if possible? 
            // No, standard import is better. But I don't want to change imports and break things.
            // I'll skip fs check for now and rely on the shell path logic which is the core fix.
        } catch (e) { }

        // Use user's home directory as CWD
        // Use user's home directory as CWD
        const cwd = os.homedir();

        try {
            // Test spawn
            // const ptyProcess = pty.spawn('/bin/echo', ['hello'], { ... }); 

            const args = os.platform() === 'win32' ? [] : ['--login'];
            const ptyProcess = pty.spawn(shell, args, {
                name: 'xterm-256color',
                cols: cols || 80,
                rows: rows || 24,
                cwd: cwd,
                env: sanitizedEnv() as any
            });

            this.ptyProcesses.set(id, ptyProcess);

            ptyProcess.onData((data) => {
                if (!sender.isDestroyed()) {
                    sender.send('terminal:data', id, data);
                }
            });

            ptyProcess.onExit(({ exitCode }) => {
                if (!sender.isDestroyed()) {
                    sender.send('terminal:exit', id, exitCode);
                }
                this.ptyProcesses.delete(id);
            });

            return true;
        } catch (error) {
            console.error('Failed to spawn terminal:', error);
            throw error;
        }
    }

    createExecTerminal(sender: Electron.WebContents, id: string, cols: number, rows: number, context: string, namespace: string, podName: string, containerName?: string) {
        // Enforce terminal ID length
        if (id.length > MAX_TERMINAL_ID_LENGTH) {
            throw new Error(`Terminal ID exceeds maximum length of ${MAX_TERMINAL_ID_LENGTH} characters`);
        }

        // Validate all Kubernetes parameters before spawning
        validateK8sName(context);
        validateK8sName(namespace);
        validateK8sName(podName);
        if (containerName) {
            validateK8sName(containerName);
        }

        if (this.ptyProcesses.has(id)) {
            this.ptyProcesses.get(id)?.kill();
        }

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
                env: sanitizedEnv() as any
            });

            this.ptyProcesses.set(id, ptyProcess);

            ptyProcess.onData((data) => {
                if (!sender.isDestroyed()) {
                    sender.send('terminal:data', id, data);
                }
            });

            ptyProcess.onExit(({ exitCode }) => {
                if (!sender.isDestroyed()) {
                    sender.send('terminal:exit', id, exitCode);
                }
                this.ptyProcesses.delete(id);
            });

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

        const ptyProcess = this.ptyProcesses.get(id);
        if (ptyProcess) {
            ptyProcess.write(data);
        } else {
            console.warn(`TerminalService: Write failed - terminal ${id} not found. Available:`, Array.from(this.ptyProcesses.keys()));
        }
    }

    resize(id: string, cols: number, rows: number) {
        const ptyProcess = this.ptyProcesses.get(id);
        if (ptyProcess) {
            try {
                ptyProcess.resize(cols, rows);
            } catch (err) {
                // suppress resize errors if process is dying
            }
        }
    }

    dispose(id: string) {
        const ptyProcess = this.ptyProcesses.get(id);
        if (ptyProcess) {
            ptyProcess.kill();
            this.ptyProcesses.delete(id);
        }
    }

    disposeAll() {
        for (const ptyProcess of this.ptyProcesses.values()) {
            ptyProcess.kill();
        }
        this.ptyProcesses.clear();
    }
}
