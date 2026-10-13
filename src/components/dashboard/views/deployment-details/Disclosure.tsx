import React, { useCallback, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { FOCUS_RING } from './status-classes';

interface DisclosureProps {
    /** Header content (rendered inside the toggle button). */
    title: React.ReactNode;
    /** Extra header content rendered to the right of the toggle (outside the button). */
    aside?: React.ReactNode;
    defaultOpen?: boolean;
    className?: string;
    buttonClassName?: string;
    /** Children are mounted only while open (lazy). */
    children: React.ReactNode;
}

/** Collapsible block; children mount only while expanded, with a Framer height animation (reduced-motion aware). */
const DisclosureInner: React.FC<DisclosureProps> = ({ title, aside, defaultOpen = false, className, buttonClassName, children }) => {
    const [open, setOpen] = useState(defaultOpen);
    const reduceMotion = useReducedMotion();
    const toggle = useCallback(() => setOpen(o => !o), []);
    return (
        <div className={className}>
            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    className={`flex items-center gap-2 min-w-0 text-left rounded ${FOCUS_RING} ${buttonClassName ?? 'text-sm font-medium text-gray-300 hover:text-white'}`}
                >
                    {open ? <ChevronDown size={14} className="shrink-0" aria-hidden="true" /> : <ChevronRight size={14} className="shrink-0" aria-hidden="true" />}
                    {title}
                </button>
                {aside}
            </div>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.15 }}
                        className="overflow-hidden"
                    >
                        <div className="pt-3">{children}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export const Disclosure = React.memo(DisclosureInner);
