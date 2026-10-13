import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { FOCUS_RING } from './status-classes';

export interface SectionNavItem { id: string; label: string }

interface SectionNavProps {
    sections: SectionNavItem[];
}

/** Gap kept between the sticky nav and a section heading after a jump. */
const JUMP_GAP_PX = 12;
/** How long the scroll must be idle before a programmatic jump is considered finished. */
const SCROLL_IDLE_MS = 150;

/** Nearest ancestor that actually scrolls vertically (the dashboard content area). */
function getScrollParent(el: HTMLElement | null): HTMLElement | null {
    let node = el?.parentElement ?? null;
    while (node) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
        node = node.parentElement;
    }
    return null;
}

/**
 * Sticky jump nav. Scrolls only the dashboard scroll container (scrollIntoView would also scroll
 * overflow-hidden layout ancestors and leave the glass panels misaligned), and highlights the last
 * section whose top has passed under the nav. While a click-initiated scroll is in flight the clicked
 * tab stays active so intermediate positions can't override it.
 */
const SectionNavInner: React.FC<SectionNavProps> = ({ sections }) => {
    const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
    const reduceMotion = useReducedMotion();
    const navRef = useRef<HTMLElement>(null);
    const lockedIdRef = useRef<string | null>(null);
    const idleTimerRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        const container = getScrollParent(navRef.current);
        if (!container) return;
        let frame = 0;

        const computeActive = () => {
            frame = 0;
            if (lockedIdRef.current) return;
            const navBottom = navRef.current?.getBoundingClientRect().bottom ?? container.getBoundingClientRect().top;
            const threshold = navBottom + JUMP_GAP_PX + 4;
            let current: string | null = sections[0]?.id ?? null;
            for (const s of sections) {
                const el = document.getElementById(s.id);
                if (el && el.getBoundingClientRect().top <= threshold) current = s.id;
            }
            setActiveId(current);
        };

        const onScroll = () => {
            if (lockedIdRef.current) {
                // Release the lock once the programmatic scroll settles.
                window.clearTimeout(idleTimerRef.current);
                idleTimerRef.current = window.setTimeout(() => { lockedIdRef.current = null; }, SCROLL_IDLE_MS);
                return;
            }
            if (!frame) frame = requestAnimationFrame(computeActive);
        };
        // Any direct user scroll input cancels the lock immediately.
        const releaseLock = () => { lockedIdRef.current = null; };

        container.addEventListener('scroll', onScroll, { passive: true });
        container.addEventListener('wheel', releaseLock, { passive: true });
        container.addEventListener('touchstart', releaseLock, { passive: true });
        container.addEventListener('keydown', releaseLock);
        computeActive();
        return () => {
            container.removeEventListener('scroll', onScroll);
            container.removeEventListener('wheel', releaseLock);
            container.removeEventListener('touchstart', releaseLock);
            container.removeEventListener('keydown', releaseLock);
            if (frame) cancelAnimationFrame(frame);
            window.clearTimeout(idleTimerRef.current);
        };
    }, [sections]);

    const jumpTo = useCallback((id: string) => {
        const el = document.getElementById(id);
        const container = getScrollParent(navRef.current);
        if (!el || !container) return;
        const navHeight = navRef.current?.offsetHeight ?? 0;
        const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - navHeight - JUMP_GAP_PX;
        const target = Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight));
        setActiveId(id);
        if (Math.abs(container.scrollTop - target) < 1) return; // already there, no scroll event will fire
        lockedIdRef.current = id;
        window.clearTimeout(idleTimerRef.current);
        // Safety release in case the container never emits scroll events.
        idleTimerRef.current = window.setTimeout(() => { lockedIdRef.current = null; }, 1500);
        container.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
    }, [reduceMotion]);

    return (
        <nav
            ref={navRef}
            aria-label="Deployment sections"
            className="sticky top-0 z-10 bg-[#0f1115]/80 border border-white/10 backdrop-blur-xl rounded-xl px-2 py-1.5 overflow-x-auto shadow-xl"
        >
            <ul className="flex items-center gap-1 min-w-max">
                {sections.map(s => {
                    const isActive = s.id === activeId;
                    return (
                        <li key={s.id}>
                            <button
                                type="button"
                                onClick={() => jumpTo(s.id)}
                                aria-current={isActive ? 'location' : undefined}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-200 ${FOCUS_RING} ${isActive
                                    ? 'bg-white/10 text-blue-400'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                            >
                                {s.label}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
};

export const SectionNav = React.memo(SectionNavInner);
