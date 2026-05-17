/**
 * Mutation Policy for Kubernetes IPC action classification and Safe Mode enforcement.
 *
 * Classifies IPC channel names into READ, MUTATE, or DESTRUCTIVE categories
 * and enforces Safe Mode by blocking mutating and destructive operations.
 */

/** Action classification for IPC channels. */
export type ActionClass = 'READ' | 'MUTATE' | 'DESTRUCTIVE';

/** Patterns matching destructive operations (e.g., k8s:deletePod, k8s:deleteResource). */
export const DESTRUCTIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /^k8s:delete/,
  /^k8s:deleteResource$/,
];

/** Patterns matching mutating operations (e.g., k8s:scaleDeployment, k8s:restartDeployment). */
export const MUTATE_PATTERNS: ReadonlyArray<RegExp> = [
  /^k8s:scale/,
  /^k8s:restart/,
  /^k8s:update.*Yaml$/,
  /^k8s:triggerCronJob$/,
  /^k8s:startPortForward$/,
];

/**
 * Classify an IPC channel name into an action category.
 *
 * Classification rules:
 * - DESTRUCTIVE: channels matching delete* or deleteResource patterns
 * - MUTATE: channels matching scale*, restart*, update*Yaml, triggerCronJob, startPortForward
 * - READ: all get*, list*, watch*, and other channels (default)
 */
export function classify(channel: string): ActionClass {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(channel)) {
      return 'DESTRUCTIVE';
    }
  }

  for (const pattern of MUTATE_PATTERNS) {
    if (pattern.test(channel)) {
      return 'MUTATE';
    }
  }

  return 'READ';
}

/**
 * Check if the action is allowed given the current Safe Mode state.
 *
 * - READ actions are always allowed regardless of Safe Mode.
 * - MUTATE and DESTRUCTIVE actions are blocked when Safe Mode is enabled.
 */
export function isAllowed(channel: string, safeModeEnabled: boolean): boolean {
  if (!safeModeEnabled) {
    return true;
  }

  const actionClass = classify(channel);
  return actionClass === 'READ';
}
