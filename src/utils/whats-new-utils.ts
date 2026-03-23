import { WhatsNewRelease } from '../data/whats-new';

/**
 * Determines whether the What's New modal should be shown.
 * - Always shows in dev mode (isPackaged === false)
 * - Shows when stored version doesn't match current (including null stored)
 */
export function shouldShowWhatsNew({
    current,
    stored,
    isPackaged,
}: {
    current: string;
    stored: string | null;
    isPackaged: boolean;
}): boolean {
    if (!isPackaged) return true;
    return stored !== current;
}

/**
 * Looks up a release entry by version string.
 * Returns the matching entry or undefined if not found.
 */
export function findRelease(
    releases: WhatsNewRelease[],
    version: string
): WhatsNewRelease | undefined {
    return releases.find((r) => r.version === version);
}

/**
 * Handles dismissal of the What's New modal.
 * Only persists the version in production (isPackaged === true).
 * In dev mode, does nothing to allow the modal to re-appear on every launch.
 */
export function handleDismiss({
    version,
    isPackaged,
    setLastSeenVersion,
}: {
    version: string;
    isPackaged: boolean;
    setLastSeenVersion: (v: string) => void;
}): void {
    if (isPackaged) {
        setLastSeenVersion(version);
    }
}
