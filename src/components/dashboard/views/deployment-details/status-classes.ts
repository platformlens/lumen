/**
 * Static status colour class maps for the Deployment Full View.
 * Kept as literal strings (never template-built) so Tailwind's purge keeps them.
 */
export type StatusColor = 'green' | 'yellow' | 'red' | 'blue' | 'gray';

/** Badge/pill classes: tinted background + text + border. */
export const STATUS_CLASSES: Record<StatusColor, string> = {
    green: 'bg-green-500/10 text-green-400 border border-green-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    red: 'bg-red-500/10 text-red-400 border border-red-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    gray: 'bg-gray-500/20 text-gray-300 border border-white/10',
};

/** Text-only colour classes. */
export const STATUS_TEXT_CLASSES: Record<StatusColor, string> = {
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    gray: 'text-gray-400',
};

/** Banner/card classes (rounded panel tinted by status). */
export const STATUS_BANNER_CLASSES: Record<StatusColor, string> = {
    green: 'bg-green-500/10 border border-green-500/20 text-green-400',
    yellow: 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400',
    red: 'bg-red-500/10 border border-red-500/20 text-red-400',
    blue: 'bg-blue-500/10 border border-blue-500/20 text-blue-400',
    gray: 'bg-white/5 border border-white/10 text-gray-400',
};

/** Maps a `getDeploymentStatus` colour string onto the static palette. */
export function toStatusColor(color: string): StatusColor {
    return color === 'green' || color === 'yellow' || color === 'red' || color === 'blue' ? color : 'gray';
}

/** Solid dot fills for pod status dots (Pod Distribution). */
export const STATUS_DOT_CLASSES: Record<StatusColor, string> = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
    blue: 'bg-blue-500',
    gray: 'bg-gray-500',
};

const FAILED_POD_STATUSES = new Set([
    'Failed', 'CrashLoopBackOff', 'Error', 'OOMKilled', 'ImagePullBackOff', 'ErrImagePull',
    'CreateContainerConfigError', 'CreateContainerError', 'InvalidImageName', 'RunContainerError', 'Evicted',
]);

/** Pod status colour: gray Terminating, red failed / CrashLoop, green Running and ready, yellow otherwise. */
export function podStatusColor(pod: {
    displayStatus: string; phase: string; deletionTimestamp: string | null; readyContainers: number; totalContainers: number;
}): StatusColor {
    if (pod.deletionTimestamp || pod.displayStatus === 'Terminating') return 'gray';
    const reason = pod.displayStatus.startsWith('Init:') ? pod.displayStatus.slice(5) : pod.displayStatus;
    if (pod.phase === 'Failed' || FAILED_POD_STATUSES.has(reason)) return 'red';
    if (pod.phase === 'Succeeded') return 'gray';
    if (pod.phase === 'Running' && pod.totalContainers > 0 && pod.readyContainers === pod.totalContainers) return 'green';
    return 'yellow';
}

/** Focus ring shared by interactive elements on the page. */
export const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50';
