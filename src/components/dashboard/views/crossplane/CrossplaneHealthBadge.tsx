import React from 'react';
import { Pause } from 'lucide-react';
import type { ConditionStatus, CrossplaneHealth } from '../../../../types/crossplane';

const HEALTH_STYLES: Record<CrossplaneHealth, { className: string; label: string }> = {
    healthy: { className: 'bg-green-500/10 text-green-400', label: 'Healthy' },
    progressing: { className: 'bg-yellow-500/10 text-yellow-400', label: 'Progressing' },
    unhealthy: { className: 'bg-red-500/10 text-red-400', label: 'Unhealthy' },
    unknown: { className: 'bg-gray-500/20 text-gray-300', label: 'Unknown' },
    paused: { className: 'bg-gray-500/20 text-gray-300', label: 'Paused' },
    none: { className: 'text-gray-500', label: '—' },
};

interface CrossplaneHealthBadgeProps {
    health: CrossplaneHealth;
    reason?: string;
}

/** Health pill. The text label is always present; colour is never the only signal. */
export const CrossplaneHealthBadge: React.FC<CrossplaneHealthBadgeProps> = ({ health, reason }) => {
    const style = HEALTH_STYLES[health] ?? HEALTH_STYLES.unknown;
    return (
        <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${style.className}`}
            title={reason ? `${style.label}: ${reason}` : style.label}
        >
            {health === 'paused' && <Pause size={10} aria-hidden="true" />}
            {style.label}
        </span>
    );
};

const CONDITION_STYLES: Record<ConditionStatus, string> = {
    True: 'bg-green-500/10 text-green-400',
    False: 'bg-red-500/10 text-red-400',
    Unknown: 'bg-gray-500/20 text-gray-300',
};

/** Compact True/False/Unknown pill for condition columns (Synced, Ready, Installed, …). */
export const CrossplaneConditionPill: React.FC<{ status?: ConditionStatus }> = ({ status }) => {
    if (!status) return <span className="text-gray-500">—</span>;
    return <span className={`px-2 py-0.5 rounded text-xs ${CONDITION_STYLES[status]}`}>{status}</span>;
};
