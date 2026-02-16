import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactElement;
    placement?: 'top' | 'bottom' | 'right' | 'left';
    className?: string;
    delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ 
    content, 
    children, 
    placement = 'top',
    className = '',
    delay = 200
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<any>(null);

    const handleMouseEnter = () => {
        timerRef.current = setTimeout(() => {
            if (triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                const scrollY = window.scrollY;
                const scrollX = window.scrollX;

                let top = 0;
                let left = 0;

                // Basic positioning logic (can be expanded)
                switch (placement) {
                    case 'top':
                        top = rect.top + scrollY - 8; // 8px buffer
                        left = rect.left + scrollX + (rect.width / 2);
                        break;
                    case 'bottom':
                        top = rect.bottom + scrollY + 8;
                        left = rect.left + scrollX + (rect.width / 2);
                        break;
                    case 'right':
                        top = rect.top + scrollY + (rect.height / 2);
                        left = rect.right + scrollX + 8;
                        break;
                    case 'left':
                        top = rect.top + scrollY + (rect.height / 2);
                        left = rect.left + scrollX - 8;
                        break;
                }

                setCoords({ top, left });
                setIsVisible(true);
            }
        }, delay);
    };

    const handleMouseLeave = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setIsVisible(false);
    };

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    // Clone child to attach refs and events without wrapping in a div (which might break layout)
    // But wrapping in a div is safer for ref handling. Let's try to clone first if it's a single element.
    // Actually, creating a wrapper div (inline-block) is often surprisingly robust and easier.
    // For sidebar items which might be flex, `contents` or proper wrapper style is needed.
    // Let's use a wrapper div.

    return (
        <div 
            ref={triggerRef} 
            className={className}
            onMouseEnter={handleMouseEnter} 
            onMouseLeave={handleMouseLeave}
        >
            {children}
            {createPortal(
                <AnimatePresence>
                    {isVisible && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.15 }}
                            style={{ 
                                top: coords.top, 
                                left: coords.left,
                                position: 'absolute',
                                zIndex: 9999,
                                pointerEvents: 'none', // Don't block mouse
                            }}
                            className={`fixed px-2 py-1 bg-gray-900 border border-white/10 text-xs text-gray-200 rounded shadow-xl whitespace-nowrap backdrop-blur-sm transform -translate-x-1/2 -translate-y-[100%] ${
                                placement === 'right' ? '-translate-y-1/2 translate-x-0' : ''
                            } ${
                                placement === 'bottom' ? '-translate-x-1/2 translate-y-0' : ''
                            } ${
                                placement === 'left' ? '-translate-y-1/2 -translate-x-[100%]' : ''
                            }`}
                        >
                            {content}
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </div>
    );
};
