import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { lumenLogo } from '../../assets/lumen-logo';

interface SplashScreenProps {
    onFinished: () => void;
    /** Minimum time (ms) the splash stays visible. Default 2200. */
    minDuration?: number;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinished, minDuration = 2200 }) => {
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setVisible(false), minDuration);
        return () => clearTimeout(timer);
    }, [minDuration]);

    return (
        <AnimatePresence onExitComplete={onFinished}>
            {visible && (
                <motion.div
                    key="splash"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }}
                    className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
                    style={{ background: '#050508' }}
                >
                    {/* Ambient background glow */}
                    <div className="absolute inset-0 pointer-events-none">
                        {/* Top-left blue glow */}
                        <motion.div
                            className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full"
                            style={{
                                background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
                            }}
                            animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
                            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        {/* Bottom-right purple glow */}
                        <motion.div
                            className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full"
                            style={{
                                background: 'radial-gradient(circle, rgba(139,92,246,0.10) 0%, transparent 70%)',
                            }}
                            animate={{ scale: [1.1, 1, 1.1], opacity: [0.5, 0.8, 0.5] }}
                            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        {/* Center warm glow behind logo */}
                        <motion.div
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full"
                            style={{
                                background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
                            }}
                            animate={{ scale: [0.9, 1.1, 0.9] }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                        />
                    </div>

                    {/* Floating grid / constellation dots */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <radialGradient id="dotGlow" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor="rgba(147,197,253,0.6)" />
                                <stop offset="100%" stopColor="rgba(147,197,253,0)" />
                            </radialGradient>
                        </defs>
                        {/* Constellation lines */}
                        <motion.line
                            x1="15%" y1="25%" x2="30%" y2="18%"
                            stroke="rgba(147,197,253,0.08)" strokeWidth="1"
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: 1 }}
                            transition={{ duration: 1.5, delay: 0.3 }}
                        />
                        <motion.line
                            x1="30%" y1="18%" x2="42%" y2="30%"
                            stroke="rgba(147,197,253,0.06)" strokeWidth="1"
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: 1 }}
                            transition={{ duration: 1.5, delay: 0.5 }}
                        />
                        <motion.line
                            x1="65%" y1="70%" x2="78%" y2="62%"
                            stroke="rgba(147,197,253,0.07)" strokeWidth="1"
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: 1 }}
                            transition={{ duration: 1.5, delay: 0.7 }}
                        />
                        <motion.line
                            x1="78%" y1="62%" x2="85%" y2="75%"
                            stroke="rgba(147,197,253,0.05)" strokeWidth="1"
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: 1 }}
                            transition={{ duration: 1.5, delay: 0.9 }}
                        />
                        <motion.line
                            x1="20%" y1="72%" x2="35%" y2="80%"
                            stroke="rgba(147,197,253,0.06)" strokeWidth="1"
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: 1 }}
                            transition={{ duration: 1.5, delay: 0.6 }}
                        />
                        <motion.line
                            x1="55%" y1="20%" x2="70%" y2="28%"
                            stroke="rgba(147,197,253,0.05)" strokeWidth="1"
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: 1 }}
                            transition={{ duration: 1.5, delay: 0.8 }}
                        />

                        {/* Dots at constellation vertices */}
                        {[
                            { cx: '15%', cy: '25%', delay: 0.2 },
                            { cx: '30%', cy: '18%', delay: 0.4 },
                            { cx: '42%', cy: '30%', delay: 0.6 },
                            { cx: '65%', cy: '70%', delay: 0.5 },
                            { cx: '78%', cy: '62%', delay: 0.7 },
                            { cx: '85%', cy: '75%', delay: 0.9 },
                            { cx: '20%', cy: '72%', delay: 0.3 },
                            { cx: '35%', cy: '80%', delay: 0.8 },
                            { cx: '55%', cy: '20%', delay: 0.4 },
                            { cx: '70%', cy: '28%', delay: 0.6 },
                            { cx: '90%', cy: '15%', delay: 1.0 },
                            { cx: '8%',  cy: '50%', delay: 0.5 },
                            { cx: '50%', cy: '88%', delay: 0.7 },
                            { cx: '92%', cy: '45%', delay: 0.8 },
                        ].map((dot, i) => (
                            <motion.circle
                                key={i}
                                cx={dot.cx}
                                cy={dot.cy}
                                r="2"
                                fill="rgba(147,197,253,0.4)"
                                initial={{ opacity: 0, scale: 0 }}
                                animate={{ opacity: [0, 0.6, 0.3], scale: [0, 1.2, 1] }}
                                transition={{ duration: 1, delay: dot.delay, ease: 'easeOut' }}
                            />
                        ))}
                    </svg>

                    {/* Orbiting ring */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                        <motion.div
                            className="w-[180px] h-[180px] rounded-full border border-white/[0.04]"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                        >
                            <motion.div
                                className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-blue-400/40"
                                animate={{ opacity: [0.3, 0.8, 0.3] }}
                                transition={{ duration: 2, repeat: Infinity }}
                            />
                        </motion.div>
                    </div>

                    {/* Center content */}
                    <div className="relative z-10 flex flex-col items-center gap-6">
                        {/* Logo with glow */}
                        <motion.div
                            className="relative"
                            initial={{ opacity: 0, scale: 0.8, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        >
                            {/* Logo glow ring */}
                            <motion.div
                                className="absolute inset-0 -m-3 rounded-full"
                                style={{
                                    background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
                                }}
                                animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                            />
                            <img
                                src={lumenLogo}
                                alt="Lumen"
                                className="w-20 h-20 relative z-10 drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]"
                            />
                        </motion.div>

                        {/* App name */}
                        <motion.div
                            className="flex flex-col items-center gap-1"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.3, ease: 'easeOut' }}
                        >
                            <h1 className="text-2xl font-bold tracking-wide text-white/90">
                                Lumen
                            </h1>
                            <p className="text-xs text-gray-500 tracking-widest uppercase">
                                Kubernetes Management
                            </p>
                        </motion.div>

                        {/* Loading indicator */}
                        <motion.div
                            className="flex flex-col items-center gap-3 mt-2"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.6 }}
                        >
                            {/* Animated bar */}
                            <div className="w-40 h-[2px] bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full rounded-full"
                                    style={{
                                        background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.6), transparent)',
                                    }}
                                    animate={{ x: ['-100%', '200%'] }}
                                    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                                />
                            </div>
                            <motion.span
                                className="text-[11px] text-gray-600"
                                animate={{ opacity: [0.4, 0.8, 0.4] }}
                                transition={{ duration: 2, repeat: Infinity }}
                            >
                                Loading workspace…
                            </motion.span>
                        </motion.div>
                    </div>

                    {/* Version badge — bottom */}
                    <motion.div
                        className="absolute bottom-8 text-[10px] text-gray-700 tracking-wider"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1 }}
                    >
                        v{window.__APP_VERSION__ || '0.0.0'}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
