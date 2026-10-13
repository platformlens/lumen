import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { TimeAgo } from '../../../shared/TimeAgo';
import type { RevisionEntry } from '../../../../utils/deployment-history-utils';
import { FOCUS_RING } from './status-classes';
import { formatAbsolute, formatGap, isWithin48h, relativeTimeText, revisionKey, type RevisionMeta } from './revision-format';

interface RevisionTimelineProps {
    entries: RevisionEntry[];
    selectedKey: string | null;
    meta: Map<string, RevisionMeta>;
    onSelect: (entry: RevisionEntry) => void;
}

const CARD_WIDTH = 320;

const NODE_CLASSES = {
    current: 'bg-green-500/20 border-green-500/40 text-green-300',
    active: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400',
    historical: 'bg-white/5 border-white/10 text-gray-300',
} as const;

const nodeVariant = (e: RevisionEntry): keyof typeof NODE_CLASSES =>
    e.isCurrent ? 'current' : e.isActive ? 'active' : 'historical';

function ariaLabelFor(e: RevisionEntry): string {
    const parts = [`Revision ${e.revisionLabel}`, `created ${relativeTimeText(e.createdAt)}`];
    if (e.isCurrent) parts.push('current');
    else if (e.isActive) parts.push('rolling');
    parts.push(`${e.readyReplicas} of ${e.desiredReplicas} ready`);
    return parts.join(', ');
}

const RevisionHoverCard: React.FC<{ entry: RevisionEntry; meta: RevisionMeta | undefined; left: number }> = ({ entry, meta, left }) => {
    const reduceMotion = useReducedMotion();
    return (
        <motion.div
            role="tooltip"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            style={{ left }}
            className="absolute top-full mt-2 bg-[#1e1e1e] border border-white/10 rounded-xl shadow-xl p-3 z-50 w-80 pointer-events-none text-xs space-y-2"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">Revision {entry.revisionLabel}</span>
                <span className="text-gray-400">{entry.readyReplicas}/{entry.desiredReplicas} ready</span>
            </div>
            <div className="text-gray-400">
                {formatAbsolute(entry.createdAt)}
                {/* TimeAgo switches to an absolute date after 48h, so only append the relative label when recent */}
                {isWithin48h(entry.createdAt) && <> · <TimeAgo timestamp={entry.createdAt} /> ago</>}
            </div>
            <div className={entry.changeCause ? 'text-gray-300 break-words' : 'text-gray-500 italic'}>
                {entry.changeCause ?? 'No change-cause recorded'}
            </div>
            {entry.images.length > 0 && (
                <ul className="space-y-0.5">
                    {entry.images.map(img => (
                        <li key={`${img.kind}-${img.container}`} className="font-mono text-gray-300 break-all">
                            <span className="text-gray-500">{img.container}: </span>{img.image}
                        </li>
                    ))}
                </ul>
            )}
            {meta && meta.summary.lines.length > 0 && (
                <ul className="border-t border-white/10 pt-2 space-y-0.5 text-gray-300">
                    {meta.summary.lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}
                    {meta.summary.more > 0 && <li className="text-gray-500">+{meta.summary.more} more</li>}
                </ul>
            )}
            {meta && meta.warningCount > 0 && (
                <div className="flex items-center gap-1 text-red-400">
                    <AlertTriangle size={12} aria-hidden="true" /> {meta.warningCount} warning event{meta.warningCount === 1 ? '' : 's'}
                </div>
            )}
        </motion.div>
    );
};

const RevisionTimelineInner: React.FC<RevisionTimelineProps> = ({ entries, selectedKey, meta, onSelect }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
    const [hover, setHover] = useState<{ key: string; left: number } | null>(null);

    const selectedIndex = Math.max(0, entries.findIndex(e => revisionKey(e) === selectedKey));
    const currentEntry = entries.find(e => e.isCurrent);
    const currentKey = currentEntry ? revisionKey(currentEntry) : null;

    // Keep the current revision in view (horizontal scroll only; never scrolls the page).
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        const node = currentKey ? nodeRefs.current.get(currentKey) : undefined;
        if (!scroller || !node) return;
        scroller.scrollLeft = Math.max(0, node.offsetLeft - scroller.clientWidth / 2 + node.offsetWidth / 2);
    }, [currentKey]);

    const showCard = useCallback((key: string) => {
        const node = nodeRefs.current.get(key);
        const container = containerRef.current;
        const scroller = scrollerRef.current;
        if (!node || !container || !scroller) return;
        const center = node.offsetLeft - scroller.scrollLeft + node.offsetWidth / 2;
        const left = Math.max(0, Math.min(center - CARD_WIDTH / 2, container.clientWidth - CARD_WIDTH));
        setHover({ key, left });
    }, []);
    const hideCard = useCallback(() => setHover(null), []);

    // Hide the card when the track scrolls (its position would drift).
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        scroller.addEventListener('scroll', hideCard, { passive: true });
        return () => scroller.removeEventListener('scroll', hideCard);
    }, [hideCard]);

    const moveTo = useCallback((index: number) => {
        const entry = entries[index];
        if (!entry) return;
        onSelect(entry);
        nodeRefs.current.get(revisionKey(entry))?.focus();
    }, [entries, onSelect]);

    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowRight': e.preventDefault(); moveTo(Math.min(entries.length - 1, selectedIndex + 1)); break;
            case 'ArrowLeft': e.preventDefault(); moveTo(Math.max(0, selectedIndex - 1)); break;
            case 'Home': e.preventDefault(); moveTo(0); break;
            case 'End': e.preventDefault(); moveTo(entries.length - 1); break;
            case 'Escape': hideCard(); break;
            default: break;
        }
    }, [entries.length, selectedIndex, moveTo, hideCard]);

    const hovered = hover ? entries.find(e => revisionKey(e) === hover.key) : undefined;

    return (
        <div ref={containerRef} className="relative">
            <div ref={scrollerRef} className="overflow-x-auto pb-2">
                <div
                    role="listbox"
                    aria-label="Revision history"
                    aria-orientation="horizontal"
                    onKeyDown={onKeyDown}
                    className="relative flex items-start min-w-max px-2 pt-6"
                >
                    {entries.map((entry, i) => {
                        const key = revisionKey(entry);
                        const isSelected = i === selectedIndex;
                        const m = meta.get(key);
                        const prev = entries[i - 1];
                        const gapMs = prev ? Date.parse(entry.createdAt) - Date.parse(prev.createdAt) : NaN;
                        return (
                            <React.Fragment key={key}>
                                {prev && (
                                    <div className="relative w-16 shrink-0 h-7 flex items-center" aria-hidden="true">
                                        <div className="w-full h-px bg-white/10" />
                                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] text-gray-500 whitespace-nowrap">
                                            {Number.isNaN(gapMs) ? '' : formatGap(gapMs)}
                                        </span>
                                    </div>
                                )}
                                <div className="w-20 shrink-0 flex flex-col items-center gap-1">
                                    <button
                                        ref={el => { if (el) nodeRefs.current.set(key, el); else nodeRefs.current.delete(key); }}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                        aria-current={entry.isCurrent ? 'true' : undefined}
                                        aria-label={ariaLabelFor(entry)}
                                        tabIndex={isSelected ? 0 : -1}
                                        onClick={() => onSelect(entry)}
                                        onMouseEnter={() => showCard(key)}
                                        onMouseLeave={hideCard}
                                        onFocus={() => showCard(key)}
                                        onBlur={hideCard}
                                        className={`relative w-7 h-7 rounded-full border text-[10px] font-semibold flex items-center justify-center transition-colors hover:bg-white/10 ${NODE_CLASSES[nodeVariant(entry)]} ${isSelected ? 'ring-2 ring-blue-500/50' : ''} ${FOCUS_RING}`}
                                    >
                                        #{entry.revisionLabel}
                                        {m && m.warningCount > 0 && (
                                            <span className="absolute -top-2 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500/80 text-white text-[9px] leading-4 text-center" aria-hidden="true">
                                                {m.warningCount}
                                            </span>
                                        )}
                                    </button>
                                    <div className="flex items-center gap-1 h-4">
                                        {entry.isCurrent && <span className="px-1.5 rounded-full text-[10px] bg-green-500/20 text-green-300">Current</span>}
                                        {!entry.isCurrent && entry.isActive && <span className="px-1.5 rounded-full text-[10px] bg-yellow-500/10 text-yellow-400">Rolling</span>}
                                        {entry.previousRevisions.length > 0 && (
                                            <RotateCcw size={11} className="text-blue-400" aria-label="Rolled back" />
                                        )}
                                    </div>
                                    <span className="text-[10px] text-gray-500 whitespace-nowrap"><TimeAgo timestamp={entry.createdAt} /></span>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
            <AnimatePresence>
                {hover && hovered && (
                    <RevisionHoverCard key={hover.key} entry={hovered} meta={meta.get(hover.key)} left={hover.left} />
                )}
            </AnimatePresence>
        </div>
    );
};

export const RevisionTimeline = React.memo(RevisionTimelineInner);
