import React, { useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { Columns2, ExternalLink, Info, Rows2 } from 'lucide-react';
import { ToggleGroup } from '../../../shared/ToggleGroup';
import { RevisionDiffModal, type RevisionDiffSide } from '../../../resources/details/RevisionDiffModal';
import { FOCUS_RING } from './status-classes';

interface RevisionDiffEditorProps {
    left: RevisionDiffSide;
    right: RevisionDiffSide;
    /** True when a change in the current list has a masked before/after value. */
    hasHiddenValues: boolean;
}

type Layout = 'side' | 'inline';

const LAYOUT_OPTIONS = [
    { value: 'side' as const, label: 'Side by side', icon: Columns2 },
    { value: 'inline' as const, label: 'Inline', icon: Rows2 },
];

// Seeded once on mount; the user's choice wins afterwards.
const initialLayout = (): Layout =>
    typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches ? 'side' : 'inline';

const formatDate = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
};

/** Embedded Monaco revision diff (mounted on demand), same options as RevisionDiffModal. */
const RevisionDiffEditorInner: React.FC<RevisionDiffEditorProps> = ({ left, right, hasHiddenValues }) => {
    const [layout, setLayout] = useState<Layout>(initialLayout);
    const [poppedOut, setPoppedOut] = useState(false);

    return (
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-white/10 bg-[#0d0d0d]">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                    <span>
                        <span className="font-medium text-red-400/80">{left.label}</span>
                        <span className="text-gray-500 ml-2">· {formatDate(left.createdAt)}</span>
                    </span>
                    <span>
                        <span className="font-medium text-green-400/80">{right.label}</span>
                        <span className="text-gray-500 ml-2">· {formatDate(right.createdAt)}</span>
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <ToggleGroup options={LAYOUT_OPTIONS} value={layout} onChange={setLayout} />
                    <button
                        type="button"
                        onClick={() => setPoppedOut(true)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 transition-colors ${FOCUS_RING}`}
                    >
                        <ExternalLink size={12} aria-hidden="true" /> Pop out
                    </button>
                </div>
            </div>
            {hasHiddenValues && (
                <p className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-gray-400 border-b border-white/10">
                    <Info size={12} aria-hidden="true" /> Some changed values are hidden; see the change list.
                </p>
            )}
            <div className="bg-[#0a0a0a]">
                <DiffEditor
                    height="480px"
                    language="yaml"
                    theme="vs-dark"
                    original={left.yaml}
                    modified={right.yaml}
                    options={{
                        renderSideBySide: layout === 'side',
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
                        lineNumbers: 'on',
                        renderIndicators: true,
                        originalEditable: false,
                        diffWordWrap: 'on',
                        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                    }}
                />
            </div>
            {poppedOut && (
                <RevisionDiffModal isOpen onClose={() => setPoppedOut(false)} left={left} right={right} />
            )}
        </div>
    );
};

export const RevisionDiffEditor = React.memo(RevisionDiffEditorInner);
