import * as pty from 'node-pty';

import os from 'os';

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
                env: process.env as any
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

    write(id: string, data: string) {
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
