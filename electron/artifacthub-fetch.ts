/**
 * Server-side Artifact Hub requests (main process). No browser CORS.
 */
export async function artifactHubFetchMain(
    pathAndQuery: string,
    options?: { accept?: string }
): Promise<{ ok: boolean; status: number; body: string }> {
    const suffix = pathAndQuery.replace(/^\//, '');
    if (!suffix || suffix.includes('..')) {
        throw new Error('Invalid Artifact Hub path');
    }
    const url = `https://artifacthub.io/api/v1/${suffix}`;
    const res = await fetch(url, {
        headers: {
            Accept: options?.accept ?? 'application/json',
            'User-Agent': 'Lumen (Helm catalog; https://artifacthub.io/)',
        },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
}
