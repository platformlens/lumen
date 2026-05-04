import { hubFetch } from './artifacthub';
import {
    DEFAULT_HELM_CATALOG_PAYLOAD,
    resolveHelmCatalogSections,
    type HelmCatalogSection,
} from './helm-catalog-types';

export type { HelmCatalogSection } from './helm-catalog-types';
export { artifactHubPackageUrl } from './artifacthub';

export interface LoadHelmCatalogOptions {
    /** Electron: refetch Supabase config and Artifact Hub resolution (ignore TTL caches). */
    force?: boolean;
}

/**
 * Curated Helm catalog: main process loads config from Supabase (anon) with electron-store cache,
 * resolves entries via Artifact Hub. Vite-only dev falls back to bundled default + renderer fetch.
 */
export async function loadHelmCatalog(options?: LoadHelmCatalogOptions): Promise<HelmCatalogSection[]> {
    if (typeof window !== 'undefined' && window.k8s?.helm?.getCatalog) {
        return window.k8s.helm.getCatalog(options?.force ? { force: true } : undefined);
    }
    return resolveHelmCatalogSections(DEFAULT_HELM_CATALOG_PAYLOAD, hubFetch);
}
