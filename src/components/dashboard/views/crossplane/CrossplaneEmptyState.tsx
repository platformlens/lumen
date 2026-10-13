import React from 'react';
import { Cloud, RefreshCw } from 'lucide-react';
import { GlassButton } from '../../../shared/GlassButton';

interface CrossplaneEmptyStateProps {
    clusterName: string;
    /** Calls window.k8s.crossplane.detect(cluster, { force: true }) via the view's detection query. */
    onRetry: () => void;
    retrying?: boolean;
    error?: string | null;
}

/** Shown when a crossplane-* view is opened on a cluster that does not serve the Crossplane API groups. */
export const CrossplaneEmptyState: React.FC<CrossplaneEmptyStateProps> = ({ clusterName, onRetry, retrying, error }) => (
    <div className="flex items-center justify-center h-full p-6">
        <div className="bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl p-8 max-w-md w-full text-center space-y-4">
            <Cloud size={40} className="mx-auto text-gray-400" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-white">Crossplane not detected on {clusterName}</h2>
            <p className="text-sm text-gray-400">
                Lumen looks for the <span className="font-mono text-gray-300">apiextensions.crossplane.io</span> and{' '}
                <span className="font-mono text-gray-300">pkg.crossplane.io</span> API groups and did not find
                both on this cluster.
            </p>
            {error && <p className="text-sm text-red-400 break-words">{error}</p>}
            <div className="flex justify-center">
                <GlassButton variant="secondary" onClick={onRetry} isLoading={retrying} icon={<RefreshCw size={14} />}>
                    Retry detection
                </GlassButton>
            </div>
        </div>
    </div>
);
