import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronUp, Sparkles, AlertTriangle } from 'lucide-react';

interface SummaryStatBox {
    label: string;
    value: number;
    color: 'green' | 'yellow' | 'red' | 'blue' | 'gray';
}

interface ViewSummaryData {
    text: string;
    stats: SummaryStatBox[];
    issues: string[];
    fromCache: boolean;
}

interface ViewSummaryProps {
    resourceType: string;
    namespace?: string;
    enabled: boolean;
}

/**
 * Generates a fallback statistical summary from resource snapshot data.
 * Used when AI provider is unavailable or not configured.
 */
export function buildFallbackSummary(resources: Array<{ phase: string }>): string {
    const total = resources.length;
    if (total === 0) return 'No resources found.';

    const phaseCounts = new Map<string, number>();
    for (const r of resources) {
        const phase = r.phase || 'Unknown';
        phaseCounts.set(phase, (phaseCounts.get(phase) || 0) + 1);
    }

    const parts = Array.from(phaseCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([phase, count]) => `${count} ${phase.toLowerCase()}`);

    return `${total} resources: ${parts.join(', ')}`;
}

const POLL_INTERVAL = 5000;

const STAT_COLORS: Record<string, string> = {
    green: 'text-green-400 bg-green-400/10 border-green-400/20',
    yellow: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
    red: 'text-red-400 bg-red-400/10 border-red-400/20',
    blue: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    gray: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
};

export const ViewSummary: React.FC<ViewSummaryProps> = ({ resourceType, namespace, enabled }) => {
    const [data, setData] = useState<ViewSummaryData | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(true);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const mountedRef = useRef(true);

    const fetchSummary = useCallback(async () => {
        if (!enabled) return;
        try {
            setLoading(prev => prev || data === null);
            const result = await (window as any).k8s.context.getSummary(resourceType, namespace);
            if (!mountedRef.current) return;

            if (result && typeof result === 'object' && result.text) {
                setData(result as ViewSummaryData);
            } else if (result && typeof result === 'object' && result.summary) {
                // Legacy format fallback
                setData({
                    text: result.summary,
                    stats: [],
                    issues: [],
                    fromCache: result.fromCache ?? false,
                });
            } else {
                setData(null);
            }
        } catch {
            if (!mountedRef.current) return;
            setData(null);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [resourceType, namespace, enabled, data]);

    useEffect(() => {
        mountedRef.current = true;
        if (!enabled) {
            setData(null);
            return;
        }

        fetchSummary();
        intervalRef.current = setInterval(fetchSummary, POLL_INTERVAL);

        return () => {
            mountedRef.current = false;
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [resourceType, namespace, enabled]);

    if (!enabled) return null;

    if (loading && data === null) {
        return (
            <div className="mb-3 rounded-lg bg-white/5 border border-white/10 animate-pulse p-3">
                <div className="flex gap-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-10 w-20 bg-white/5 rounded" />
                    ))}
                </div>
            </div>
        );
    }

    if (!data) return null;

    const hasIssues = data.issues.length > 0;

    return (
        <div className="mb-3 rounded-lg bg-white/5 border border-white/10 overflow-hidden">
            {/* Header with toggle */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
                aria-label={expanded ? 'Collapse summary' : 'Expand summary'}
            >
                <div className="flex items-center gap-2">
                    <Sparkles size={13} className="text-purple-400" />
                    <span className="text-xs text-gray-300">{data.text}</span>
                </div>
                {expanded ? (
                    <ChevronUp size={14} className="text-gray-500 flex-shrink-0" />
                ) : (
                    <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />
                )}
            </button>

            {expanded && (
                <div className="px-3 pb-3 space-y-2">
                    {/* Stat boxes */}
                    {data.stats.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {data.stats.map((stat) => (
                                <div
                                    key={stat.label}
                                    className={`px-2.5 py-1.5 rounded border text-center min-w-[60px] ${STAT_COLORS[stat.color] || STAT_COLORS.gray}`}
                                >
                                    <div className="text-sm font-semibold leading-tight">{stat.value}</div>
                                    <div className="text-[10px] opacity-70 leading-tight">{stat.label}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Issues list */}
                    {hasIssues && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                                <AlertTriangle size={11} className="text-yellow-400" />
                                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Issues</span>
                            </div>
                            <div className="space-y-0.5">
                                {data.issues.slice(0, 8).map((issue, i) => (
                                    <div key={i} className="text-xs text-gray-400 pl-4 truncate" title={issue}>
                                        {issue}
                                    </div>
                                ))}
                                {data.issues.length > 8 && (
                                    <div className="text-xs text-gray-500 pl-4">
                                        +{data.issues.length - 8} more
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
