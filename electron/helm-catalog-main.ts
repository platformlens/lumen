import { createHash } from 'node:crypto';
import type Store from 'electron-store';
import {
    DEFAULT_HELM_CATALOG_PAYLOAD,
    resolveHelmCatalogSections,
    rowsToHelmCatalogPayload,
    type HelmCatalogPayload,
    type HelmCatalogSection,
    type HelmCatalogSectionRow,
} from '../src/lib/helm-catalog-types';
import { artifactHubFetchMain } from './artifacthub-fetch';

const REMOTE_TTL_MS = 60 * 60 * 1000;
const RESOLVED_TTL_MS = 6 * 60 * 60 * 1000;

const CATALOG_KEY = 'curated_v1';

const STORE_REMOTE = 'helm_catalog_remote_v3';
const STORE_RESOLVED = 'helm_catalog_resolved_v3';

interface CachedRemote {
    at: number;
    payload: HelmCatalogPayload;
}

interface CachedResolved {
    at: number;
    configHash: string;
    sections: HelmCatalogSection[];
}

function hashPayload(p: HelmCatalogPayload): string {
    return createHash('sha256').update(JSON.stringify(p)).digest('hex');
}

async function fetchCatalogFromSupabase(): Promise<HelmCatalogPayload | null> {
    const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !supabaseKey) return null;

    const base = supabaseUrl.replace(/\/$/, '');
    const qs = new URLSearchParams();
    qs.set('catalog_key', `eq.${CATALOG_KEY}`);
    qs.set('select', 'section_key,title,description,sort_order,resolve');
    qs.set('order', 'sort_order.asc');

    const url = `${base}/rest/v1/helm_catalog_sections?${qs.toString()}`;
    const res = await fetch(url, {
        cache: 'no-store',
        headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Accept: 'application/json',
        },
    });
    if (!res.ok) {
        console.warn('[helm-catalog] Supabase REST status', res.status);
        return null;
    }
    const rows = (await res.json()) as HelmCatalogSectionRow[];
    const payload = rowsToHelmCatalogPayload(rows);
    if (payload?.sections?.length) return payload;
    return null;
}

export interface GetHelmCatalogOptions {
    /** When true, refetch Supabase immediately (ignore remote TTL) and re-resolve Artifact Hub (ignore resolved cache). */
    force?: boolean;
}

/**
 * Public catalog: Supabase config (anon) + Artifact Hub resolution, cached in electron-store.
 */
export async function getHelmCatalogForIpc(store: Store, options?: GetHelmCatalogOptions): Promise<HelmCatalogSection[]> {
    const force = Boolean(options?.force);
    const now = Date.now();
    const remoteCached = store.get(STORE_REMOTE) as CachedRemote | undefined;

    let payload: HelmCatalogPayload = DEFAULT_HELM_CATALOG_PAYLOAD;

    const hasCreds = Boolean(
        process.env.VITE_SUPABASE_URL?.trim() && process.env.VITE_SUPABASE_ANON_KEY?.trim()
    );
    const remoteStale = !remoteCached || now - remoteCached.at > REMOTE_TTL_MS;

    if (hasCreds && (force || remoteStale)) {
        const remote = await fetchCatalogFromSupabase();
        if (remote) {
            payload = remote;
            store.set(STORE_REMOTE, { at: now, payload: remote });
        } else if (remoteCached?.payload?.sections?.length) {
            payload = remoteCached.payload;
        }
    } else if (remoteCached?.payload?.sections?.length) {
        payload = remoteCached.payload;
    }

    const configHash = hashPayload(payload);
    const resolvedCached = store.get(STORE_RESOLVED) as CachedResolved | undefined;
    if (
        !force &&
        resolvedCached &&
        resolvedCached.configHash === configHash &&
        now - resolvedCached.at < RESOLVED_TTL_MS &&
        resolvedCached.sections?.length
    ) {
        return resolvedCached.sections;
    }

    const sections = await resolveHelmCatalogSections(payload, artifactHubFetchMain);
    store.set(STORE_RESOLVED, { at: now, configHash, sections });
    return sections;
}
