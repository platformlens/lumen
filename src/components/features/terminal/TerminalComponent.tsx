import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalComponentProps {
    id?: string;
    isVisible?: boolean;
    execContext?: {
        context: string;
        namespace: string;
        podName: string;
        containerName?: string;
    };
    initialCommand?: string;
    /** Kube context a local shell is bound to (ignored for exec terminals, which carry their own). */
    clusterContext?: string;
}

/** Unique backend PTY id per session, independent of the (possibly long) tab id. */
const newBackendId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `term-${crypto.randomUUID()}`
        : `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;

// Strip control characters before echoing a context name into the terminal
// eslint-disable-next-line no-control-regex
const stripControlChars = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, '');

export const TerminalComponent: React.FC<TerminalComponentProps> = ({ id = 'main', isVisible = true, execContext, initialCommand, clusterContext }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const backendIdRef = useRef<string | null>(null);
    const [sessionStatus, setSessionStatus] = React.useState<'active' | 'exited'>('active');

    // Re-structure: Use effect for lifecycle, but allow manual trigger.
    // Solution: use a 'sessionId' state to trigger re-run of effect.
    const [sessionId, setSessionId] = React.useState(0);

    useEffect(() => {
        if (!containerRef.current) return;

        // Generate a unique ID for this specific session instance to avoid logic collisions
        // during React Strict Mode (mount/unmount/mount cycles) and across terminal tabs
        const backendId = newBackendId();
        backendIdRef.current = backendId;
        const terminalApi = window.k8s.terminal;

        let cleanupFn: (() => void) | undefined;
        let initialCommandTimer: ReturnType<typeof setTimeout> | undefined;

        const init = () => {
            // Initialize xterm
            const term = new Terminal({
                cursorBlink: true,
                theme: {
                    background: '#0d0d0d',
                    foreground: '#d1d5db', // Match text-gray-300
                    cursor: '#ffffff',
                    selectionBackground: 'rgba(255, 255, 255, 0.2)',
                },
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                fontSize: 12,
            });
            const fitAddon = new FitAddon();
            term.loadAddon(fitAddon);
            term.open(containerRef.current!); // Assert non-null

            if (isVisible) {
                try {
                    fitAddon.fit();
                    term.focus();
                } catch {
                    // container may not be laid out yet
                }
            }

            terminalRef.current = term;
            fitAddonRef.current = fitAddon;
            setSessionStatus('active');

            // Subscribe to THIS session's output before creating the backend PTY
            const cleanData = terminalApi.onData(backendId, (data) => term.write(data));
            const cleanExit = terminalApi.onExit(backendId, (code) => {
                term.write(`\r\n\x1b[31mSession ended with code ${code}.\x1b[0m\r\n`);
                setSessionStatus('exited');
            });

            // Create Backend Terminal with unique ID
            if (execContext) {
                terminalApi.createExec(
                    backendId,
                    term.cols,
                    term.rows,
                    execContext.context,
                    execContext.namespace,
                    execContext.podName,
                    execContext.containerName
                );
            } else {
                if (clusterContext) {
                    term.writeln(`\x1b[90mkube context: ${stripControlChars(clusterContext)}\x1b[0m`);
                }
                terminalApi.create(backendId, term.cols, term.rows, clusterContext);
            }

            term.onData((data) => terminalApi.write(backendId, data));

            cleanupFn = () => {
                cleanData();
                cleanExit();
                term.dispose();
                terminalApi.dispose(backendId);
            };

            // Send initial command after a short delay to let the shell initialize
            if (initialCommand && !execContext) {
                initialCommandTimer = setTimeout(() => {
                    terminalApi.write(backendId, `${initialCommand}\r`);
                }, 500);
            }
        };

        init();

        // Handle Resize Observer logic separately or included?
        // Included is safer for closure access to 'term'
        const resizeObs = new ResizeObserver(() => {
            if (!containerRef.current || !terminalRef.current || !fitAddonRef.current) return;
            // Visibility check
            if (containerRef.current.offsetParent === null) return;
            try {
                fitAddonRef.current.fit();
                const { cols, rows } = terminalRef.current;
                if (cols > 0 && rows > 0) terminalApi.resize(backendId, cols, rows);
            } catch {
                // ignore fit errors while the panel is animating / hidden
            }
        });
        resizeObs.observe(containerRef.current);

        return () => {
            if (initialCommandTimer) clearTimeout(initialCommandTimer);
            if (cleanupFn) cleanupFn();
            resizeObs.disconnect();
        };
    }, [id, sessionId]); // Depend on sessionId to re-spawn

    // Visibility Effect: refit + focus when this tab becomes active (xterm is never destroyed on tab switch)
    useEffect(() => {
        if (isVisible && terminalRef.current && fitAddonRef.current) {
            requestAnimationFrame(() => {
                if (!terminalRef.current || !fitAddonRef.current) return;
                fitAddonRef.current.fit();
                terminalRef.current.focus();
                const { cols, rows } = terminalRef.current;
                if (backendIdRef.current && cols > 0 && rows > 0) {
                    window.k8s.terminal.resize(backendIdRef.current, cols, rows);
                }
            });
        }
    }, [isVisible]);

    const handleRestart = () => {
        setSessionId(prev => prev + 1);
    };

    return (
        <div className="relative w-full h-full">
            <div
                ref={containerRef}
                className="w-full h-full p-2 bg-[#0d0d0d]"
                onClick={() => terminalRef.current?.focus()}
            />
            {sessionStatus === 'exited' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                    <button
                        onClick={handleRestart}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded shadow flex items-center gap-2"
                    >
                        <span>Restart Session</span>
                    </button>
                </div>
            )}
        </div>
    );
};
