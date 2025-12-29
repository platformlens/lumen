import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalComponentProps {
    id?: string;
    isVisible?: boolean;
}

export const TerminalComponent: React.FC<TerminalComponentProps> = ({ id = 'main', isVisible = true }) => {
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
        // during React Strict Mode (mount/unmount/mount cycles)
        const backendId = `${id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        backendIdRef.current = backendId;
        
        let cleanupFn: (() => void) | undefined;

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
                 try { fitAddon.fit(); term.focus(); } catch {}
             }

             terminalRef.current = term;
             fitAddonRef.current = fitAddon;
             setSessionStatus('active');

             // Create Backend Terminal with unique ID
             (window.k8s as any).terminal.create(backendId, term.cols, term.rows);

             term.onData((data) => (window.k8s as any).terminal.write(backendId, data));

             const cleanData = (window.k8s as any).terminal.onData((inId: string, data: string) => {
                 if (inId === backendId) term.write(data);
             });
             const cleanExit = (window.k8s as any).terminal.onExit((inId: string, code: number) => {
                 if (inId === backendId) {
                     term.write(`\r\n\x1b[31mSession ended with code ${code}.\x1b[0m\r\n`);
                     setSessionStatus('exited');
                 }
             });

             cleanupFn = () => {
                 cleanData();
                 cleanExit();
                 term.dispose();
                 (window.k8s as any).terminal.dispose(backendId);
             };
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
                 if (cols > 0 && rows > 0) (window.k8s as any).terminal.resize(backendId, cols, rows);
             } catch {}
        });
        resizeObs.observe(containerRef.current);

        return () => {
             if (cleanupFn) cleanupFn();
             resizeObs.disconnect();
        };
    }, [id, sessionId]); // Depend on sessionId to re-spawn

    // Visibility Effect
    useEffect(() => {
        if (isVisible && terminalRef.current && fitAddonRef.current) {
            requestAnimationFrame(() => {
                if (!terminalRef.current || !fitAddonRef.current) return;
                fitAddonRef.current.fit();
                terminalRef.current.focus();
                const { cols, rows } = terminalRef.current;
                if (backendIdRef.current && cols > 0 && rows > 0) {
                    (window.k8s as any).terminal.resize(backendIdRef.current, cols, rows);
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
