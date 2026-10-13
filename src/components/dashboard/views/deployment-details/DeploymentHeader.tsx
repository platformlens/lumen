import React from 'react';
import { Activity, AlertTriangle, ArrowLeft, Layers, PenTool, RefreshCw, RotateCcw, X } from 'lucide-react';
import { GlassButton } from '../../../shared/GlassButton';
import { TimeAgo } from '../../../shared/TimeAgo';
import { Tooltip } from '../../../shared/Tooltip';
import { getDeploymentStatus } from '../../../../utils/resource-utils';
import type { DeploymentObj } from '../../../../types/deployment-details';
import type { HpaSummary } from '../../../../utils/deployment-rollout-utils';
import { FOCUS_RING, STATUS_CLASSES, toStatusColor } from './status-classes';

interface DeploymentHeaderProps {
    name: string;
    namespace: string;
    clusterName: string;
    deployment: DeploymentObj;
    liveUpdates: boolean;
    isRefreshing: boolean;
    lastFetchedAt: number | null;
    refreshError: string | null;
    /** HPA targeting this deployment; drives the manual-scale warning line. */
    hpa: HpaSummary | null;
    onBack: () => void;
    onRefresh: () => void;
    onScale: () => void;
    onRestart: () => void;
    /** Omitted when the editor flow isn't available. */
    onEditYaml?: () => void;
    onDismissError: () => void;
}

const DeploymentHeaderInner: React.FC<DeploymentHeaderProps> = ({
    name, namespace, clusterName, deployment, liveUpdates, isRefreshing, lastFetchedAt, refreshError, hpa,
    onBack, onRefresh, onScale, onRestart, onEditYaml, onDismissError,
}) => {
    const { status, color } = getDeploymentStatus(deployment);
    const createdAt = deployment.metadata?.creationTimestamp;

    return (
        <header className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/20 flex items-center justify-center shrink-0">
                        <Layers size={20} className="text-blue-400" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-2xl font-bold text-white break-all">{name}</h1>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASSES[toStatusColor(color)]}`}>
                                {status}
                            </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                            <span className="text-sm text-gray-400 bg-white/5 px-2 py-1 rounded-md">
                                <span className="text-gray-500">ns </span><span className="font-mono">{namespace}</span>
                            </span>
                            <span className="text-sm text-gray-400 bg-white/5 px-2 py-1 rounded-md">
                                <span className="text-gray-500">cluster </span>{clusterName}
                            </span>
                            {createdAt && (
                                <span title={new Date(createdAt).toLocaleString()}>
                                    Age <span className="text-gray-300"><TimeAgo timestamp={createdAt} /></span>
                                </span>
                            )}
                            <Tooltip
                                placement="bottom"
                                content={liveUpdates
                                    ? 'Refreshes when the deployment changes. Pod-only changes (e.g. restarts) need Refresh.'
                                    : 'Namespace not watched by the dashboard. Use Refresh for the latest state.'}
                            >
                                <span className="inline-flex items-center gap-1.5" tabIndex={0} aria-label={liveUpdates ? 'Live updates on' : 'Live updates off'}>
                                    <span className={`w-2 h-2 rounded-full ${liveUpdates ? 'bg-green-400' : 'bg-gray-500'}`} aria-hidden="true" />
                                    {liveUpdates ? 'Live' : 'Not live'}
                                </span>
                            </Tooltip>
                            {lastFetchedAt !== null && (
                                <span>Updated <TimeAgo timestamp={lastFetchedAt} /> ago</span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <GlassButton variant="secondary" onClick={onBack} icon={<ArrowLeft size={16} />}>
                        Back to Deployments
                    </GlassButton>
                    <GlassButton
                        variant="primary"
                        onClick={onRefresh}
                        aria-label="Refresh deployment details"
                        icon={<RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />}
                    >
                        Refresh
                    </GlassButton>
                    <GlassButton variant="primary" onClick={onScale} icon={<Activity size={16} />}>
                        Scale
                    </GlassButton>
                    <button
                        type="button"
                        onClick={onRestart}
                        className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 backdrop-blur-sm shadow-lg bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 border border-orange-600/30 transition-colors ${FOCUS_RING}`}
                    >
                        <RotateCcw size={16} aria-hidden="true" /> Restart
                    </button>
                    {onEditYaml && (
                        <GlassButton variant="secondary" onClick={onEditYaml} icon={<PenTool size={16} />}>
                            Edit YAML
                        </GlassButton>
                    )}
                </div>
            </div>

            {hpa && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-yellow-400">
                    <AlertTriangle size={14} aria-hidden="true" />
                    HPA {hpa.name} manages replicas (min {hpa.min} / max {hpa.max}); a manual scale will be overridden.
                </p>
            )}
            {refreshError && (
                <div className="mt-3 flex items-start gap-2 text-xs text-yellow-400">
                    <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
                    <span className="flex-1 min-w-0 break-words">Refresh failed: {refreshError}</span>
                    <button
                        type="button"
                        onClick={onDismissError}
                        aria-label="Dismiss refresh error"
                        className={`p-0.5 rounded hover:bg-white/10 text-yellow-400 ${FOCUS_RING}`}
                    >
                        <X size={14} />
                    </button>
                </div>
            )}
        </header>
    );
};

export const DeploymentHeader = React.memo(DeploymentHeaderInner);
