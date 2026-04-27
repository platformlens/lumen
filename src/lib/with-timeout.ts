/**
 * Fails a possibly-stuck request after `ms` so UI can clear loading state.
 * (Does not cancel the underlying fetch — Supabase has limited AbortSignal support.)
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}
