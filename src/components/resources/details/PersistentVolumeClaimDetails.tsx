import React from 'react';
import { HardDrive } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface PersistentVolumeClaimDetailsProps {
    pvc: any;
    onExplain?: () => void;
    onOpenYaml?: () => void;
}

const phaseColor = (phase: string) => {
    switch (phase) {
        case 'Bound': return 'bg-green-500/10 text-green-400 border-green-500/20';
        case 'Pending': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
        case 'Lost': return 'bg-red-500/10 text-red-400 border-red-500/20';
        case 'Available': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
        default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
};

export const PersistentVolumeClaimDetails: React.FC<PersistentVolumeClaimDetailsProps> = ({ pvc, onExplain: _onExplain, onOpenYaml: _onOpenYaml }) => {
    if (!pvc) return null;

    const metadata = pvc.metadata || {};
    const spec = pvc.spec || {};
    const status = pvc.status || {};
    const phase = status.phase || 'Unknown';
    const capacityStorage = status.capacity?.storage;
    const statusAccessModes: string[] = status.accessModes || [];
    const specAccessModes: string[] = spec.accessModes || [];
    const requestedStorage = spec.resources?.requests?.storage;

    return (
        <div className="space-y-6 text-sm">
            {/* Metadata */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Metadata</h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Namespace</div>
                        <div className="col-span-2 text-white font-mono text-sm">{metadata.namespace}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">API Version</div>
                        <div className="col-span-2 text-white font-mono text-sm">{pvc.apiVersion}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created</div>
                        <div className="col-span-2 text-white text-sm">
                            {metadata.creationTimestamp ? <TimeAgo timestamp={metadata.creationTimestamp} /> : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Status */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <HardDrive size={14} className="text-blue-400" />
                    Status
                </h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Phase</div>
                        <div className="col-span-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${phaseColor(phase)}`}>
                                {phase}
                            </span>
                        </div>
                    </div>
                    {capacityStorage && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Capacity</div>
                            <div className="col-span-2 text-white font-mono text-sm">{capacityStorage}</div>
                        </div>
                    )}
                    {statusAccessModes.length > 0 && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Access Modes</div>
                            <div className="col-span-2 flex flex-wrap gap-1">
                                {statusAccessModes.map((mode: string) => (
                                    <span key={mode} className="px-2 py-0.5 rounded text-xs font-medium border bg-green-500/10 text-green-400 border-green-500/20">
                                        {mode}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Spec */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Spec</h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    {spec.storageClassName && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Storage Class</div>
                            <div className="col-span-2 text-white font-mono text-sm">{spec.storageClassName}</div>
                        </div>
                    )}
                    {spec.volumeName && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Volume Name</div>
                            <div className="col-span-2 text-white font-mono text-sm break-all">{spec.volumeName}</div>
                        </div>
                    )}
                    {spec.volumeMode && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Volume Mode</div>
                            <div className="col-span-2 text-white font-mono text-sm">{spec.volumeMode}</div>
                        </div>
                    )}
                    {specAccessModes.length > 0 && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Access Modes</div>
                            <div className="col-span-2 flex flex-wrap gap-1">
                                {specAccessModes.map((mode: string) => (
                                    <span key={mode} className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                        {mode}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {requestedStorage && (
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-gray-400">Requested Storage</div>
                            <div className="col-span-2 text-white font-mono text-sm">{requestedStorage}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Labels */}
            {metadata.labels && Object.keys(metadata.labels).length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Labels</h3>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(metadata.labels).map(([k, v]) => (
                            <span key={k} className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono">
                                {k}: {String(v)}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
