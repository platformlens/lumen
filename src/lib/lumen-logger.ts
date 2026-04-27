/**
 * Auth/org debug logging. Lives in a leaf module (no store imports) so it stays
 * defined with circular orgStore ↔ authStore imports and Vite HMR.
 *
 * Filter DevTools: `lumen:auth` or `lumen:org`
 */
export function lumenLogAuth(message: string, data?: Record<string, unknown>) {
  if (data && Object.keys(data).length > 0) {
    console.log(`[lumen:auth] ${message}`, data);
  } else {
    console.log(`[lumen:auth] ${message}`);
  }
}

export function lumenLogOrg(message: string, data?: Record<string, unknown>) {
  if (data && Object.keys(data).length > 0) {
    console.log(`[lumen:org] ${message}`, data);
  } else {
    console.log(`[lumen:org] ${message}`);
  }
}

export function lumenShortId(id: string | undefined | null): string {
  if (!id) {
    return '(none)';
  }
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
