/**
 * URL Validator for external navigation safety.
 *
 * Validates URLs before they are opened externally via shell.openExternal.
 * Only allows https: unconditionally, and http: for localhost addresses
 * (to support port-forwarded services).
 */

/** Set of hostnames allowed for http: scheme (port-forward UX). */
const ALLOWED_HTTP_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

/**
 * Returns true if the URL is safe to open externally.
 *
 * Validation rules:
 * 1. Parse the URL using the URL constructor; reject if parsing fails
 * 2. Allow https: scheme unconditionally
 * 3. Allow http: scheme only when hostname is localhost, 127.0.0.1, or [::1]
 * 4. Reject file:, javascript:, data:, and all other schemes
 */
export function isSafeExternalUrl(url: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === 'https:') {
    return true;
  }

  if (parsed.protocol === 'http:') {
    return ALLOWED_HTTP_HOSTNAMES.has(parsed.hostname);
  }

  return false;
}
