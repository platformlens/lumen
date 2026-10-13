import React, { useCallback, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { TimeAgo } from '../../../shared/TimeAgo';
import { useCrossplaneQuery } from '../../../../hooks/useCrossplaneQuery';
import { CrossplaneEmptyState } from './CrossplaneEmptyState';
import { CrossplaneOverview } from './CrossplaneOverview';
import { CrossplanePackagesView } from './CrossplanePackagesView';
import { CrossplaneDefinitionsView } from './CrossplaneDefinitionsView';
import { CrossplaneCompositesView } from './CrossplaneCompositesView';
import { CrossplaneManagedView } from './CrossplaneManagedView';
import { CROSSPLANE_SUB_VIEWS, type CrossplaneStatus, type CrossplaneSubView, type CrossplaneSubViewProps } from './crossplane-view-state';
import type { CrossplaneDetection, CrossplaneObjectRef } from '../../../../types/crossplane';

interface CrossplaneViewProps {
    /** The view id suffix after `crossplane-` (overview, packages, definitions, composites, managed). */
    subView: string;
    clusterName: string;
    searchQuery: string;
    selectedNamespaces: string[];
    onResourceClick: (resource: CrossplaneObjectRef, type: 'crossplane') => void;
    onNavigate?: (view: string) => void;
}

const TITLES: Record<CrossplaneSubView, string> = {
    overview: 'Crossplane',
    packages: 'Packages',
    definitions: 'Definitions',
    composites: 'Composites',
    managed: 'Managed Resources',
};

function versionLabel(d: CrossplaneDetection): string | null {
    if (d.version) return d.version.startsWith('v') ? d.version : `v${d.version}`;
    return d.majorVersion ? `v${d.majorVersion}.x` : null;
}

/** Detection gate, header (version, Updated, Refresh) and sub-view switch for the five crossplane-* views. */
export const CrossplaneView: React.FC<CrossplaneViewProps> = ({
    subView, clusterName, searchQuery, selectedNamespaces, onResourceClick, onNavigate,
}) => {
    const view: CrossplaneSubView = (CROSSPLANE_SUB_VIEWS as readonly string[]).includes(subView)
        ? subView as CrossplaneSubView : 'overview';

    // Main-process cache hit right after App's connect-time detection (60 s TTL)
    const detect = useCrossplaneQuery(
        force => window.k8s.crossplane.detect(clusterName, { force }),
        `${clusterName}|detect`,
        { autoRefresh: false },
    );
    const [refreshSignal, setRefreshSignal] = useState(0);
    const [status, setStatus] = useState<CrossplaneStatus>({ fetchedAt: null, busy: false });

    const onStatus = useCallback((s: CrossplaneStatus) => {
        setStatus(prev => (prev.fetchedAt === s.fetchedAt && prev.busy === s.busy ? prev : s));
    }, []);
    const { refresh: refreshDetect } = detect;
    const handleRefresh = useCallback(() => {
        refreshDetect();
        setRefreshSignal(n => n + 1);
    }, [refreshDetect]);

    const detection = detect.data;
    if (!detection) {
        if (detect.loading || (!detect.error && !detection)) {
            return (
                <div className="flex items-center justify-center h-full" role="status" aria-label="Detecting Crossplane">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
                </div>
            );
        }
        return <CrossplaneEmptyState clusterName={clusterName} onRetry={refreshDetect} retrying={detect.refreshing} error={detect.error} />;
    }
    if (!detection.installed) {
        return <CrossplaneEmptyState clusterName={clusterName} onRetry={refreshDetect} retrying={detect.loading || detect.refreshing} />;
    }

    const version = versionLabel(detection);
    const busy = status.busy || detect.refreshing;
    const subProps: CrossplaneSubViewProps = {
        clusterName, detection, searchQuery, selectedNamespaces, onResourceClick, onNavigate, refreshSignal, onStatus,
    };

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="p-6 space-y-6 pb-20">
                <div className="flex items-center justify-between gap-4">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2 min-w-0">
                        <div className="w-1 h-8 bg-orange-500 rounded-full shrink-0"></div>
                        <span className="truncate">{view === 'overview' ? TITLES.overview : `Crossplane ${TITLES[view]}`}</span>
                        {version && (
                            <span className="text-sm font-normal text-gray-400 bg-white/5 px-2 py-1 rounded-md ml-2 font-mono">{version}</span>
                        )}
                    </h2>
                    <div className="flex items-center gap-3 text-xs text-gray-400 shrink-0">
                        {status.fetchedAt && (
                            <span>Updated <TimeAgo timestamp={status.fetchedAt} /> ago</span>
                        )}
                        <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={busy}
                            aria-label="Refresh Crossplane data"
                            title="Refresh"
                            className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                <nav className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 w-fit" aria-label="Crossplane sections">
                    {CROSSPLANE_SUB_VIEWS.map(v => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => onNavigate?.(`crossplane-${v}`)}
                            aria-current={view === v ? 'page' : undefined}
                            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${view === v
                                ? 'bg-white/10 text-blue-400'
                                : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                        >
                            {v === 'overview' ? 'Overview' : TITLES[v]}
                        </button>
                    ))}
                </nav>

                {view === 'overview' && <CrossplaneOverview {...subProps} />}
                {view === 'packages' && <CrossplanePackagesView {...subProps} />}
                {view === 'definitions' && <CrossplaneDefinitionsView {...subProps} />}
                {view === 'composites' && <CrossplaneCompositesView {...subProps} />}
                {view === 'managed' && <CrossplaneManagedView {...subProps} />}
            </div>
        </div>
    );
};
