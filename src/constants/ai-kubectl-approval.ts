/** Max time to wait for Allow/Deny on a kubectl tool call before auto-decline (main + UI copy stay in sync). */
export const KUBECTL_APPROVAL_TIMEOUT_MINUTES = 10;
export const KUBECTL_APPROVAL_TIMEOUT_MS = KUBECTL_APPROVAL_TIMEOUT_MINUTES * 60 * 1000;
