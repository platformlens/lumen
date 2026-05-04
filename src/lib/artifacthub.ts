const ARTIFACTHUB_API = 'https://artifacthub.io/api/v1';

/** kind=0 is Helm chart in Artifact Hub search API */
const KIND_HELM = '0';

export interface ArtifactHubRepo {
    url: string;
    name: string;
    display_name?: string;
    organization_name?: string;
    organization_display_name?: string;
    verified_publisher?: boolean;
}

export interface ArtifactHubPackage {
    package_id: string;
    name: string;
    description: string;
    version: string;
    app_version?: string;
    deprecated?: boolean;
    repository: ArtifactHubRepo;
}

interface SearchResponse {
    packages?: ArtifactHubPackage[];
}

type HubFetchResult = { ok: boolean; status: number; body: string };

function safeRelativePath(pathAndQuery: string): string {
    const path = pathAndQuery.replace(/^\//, '');
    if (!path || path.includes('..')) {
        throw new Error('Invalid Artifact Hub path');
    }
    return path;
}

/**
 * Prefer main-process fetch in Electron (renderer loaded from file:// hits CORS as Origin null).
 */
/** Main-process IPC fetch in Electron, or direct fetch in vite dev. */
export async function hubFetch(pathAndQuery: string, options?: { accept?: string }): Promise<HubFetchResult> {
    const path = safeRelativePath(pathAndQuery);
    if (typeof window !== 'undefined' && window.k8s?.artifactHub?.fetch) {
        return window.k8s.artifactHub.fetch(path, options);
    }
    const url = `${ARTIFACTHUB_API}/${path}`;
    let res: Response;
    try {
        res = await fetch(url, {
            headers: { Accept: options?.accept ?? 'application/json' },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
            msg === 'Failed to fetch'
                ? 'Network error reaching Artifact Hub. If you use a packaged build, ensure the app is up to date.'
                : msg
        );
    }
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
}

function parseJson<T>(body: string): T {
    try {
        return JSON.parse(body) as T;
    } catch {
        throw new Error('Invalid response from Artifact Hub');
    }
}

export function artifactHubPackageUrl(pkg: ArtifactHubPackage): string {
    const repo = encodeURIComponent(pkg.repository.name);
    const chart = encodeURIComponent(pkg.name);
    return `https://artifacthub.io/packages/helm/${repo}/${chart}`;
}

/** Web UI link for a Helm chart (repo + chart names as on Artifact Hub). */
export function helmChartHubWebUrl(repoName: string, chartName: string): string {
    return `https://artifacthub.io/packages/helm/${encodeURIComponent(repoName)}/${encodeURIComponent(chartName)}`;
}

export async function searchHelmCharts(tsQuery: string, limit = 25): Promise<ArtifactHubPackage[]> {
    const params = new URLSearchParams({
        offset: '0',
        limit: String(limit),
        kind: KIND_HELM,
        ts_query: tsQuery,
    });
    const { ok, status, body } = await hubFetch(`packages/search?${params}`);
    if (!ok) {
        throw new Error(`Artifact Hub search failed (${status})`);
    }
    const data = parseJson<SearchResponse>(body);
    return data.packages ?? [];
}

/** Full Helm package from Artifact Hub (includes readme for default/latest version). */
export interface HelmChartDependency {
    name: string;
    version: string;
    repository: string;
}

export interface HelmPackageDetail {
    package_id: string;
    name: string;
    description: string;
    version: string;
    app_version?: string;
    readme?: string;
    deprecated?: boolean;
    prerelease?: boolean;
    contains_security_updates?: boolean;
    has_values_schema?: boolean;
    has_changelog?: boolean;
    signed?: boolean;
    content_url?: string;
    home_url?: string;
    digest?: string;
    license?: string;
    keywords?: string[];
    links?: Array<{ name: string; url: string }>;
    available_versions?: Array<{
        version: string;
        contains_security_updates: boolean;
        prerelease: boolean;
        ts: number;
    }>;
    repository: ArtifactHubRepo & { repository_id?: string };
    crds?: Array<{
        kind: string;
        name: string;
        version: string;
        description: string;
        displayName: string;
    }>;
    data?: {
        apiVersion?: string;
        type?: string;
        kubeVersion?: string;
        dependencies?: HelmChartDependency[];
    };
}

function helmPathSegment(value: string): string {
    return encodeURIComponent(value);
}

export async function fetchHelmPackage(repoName: string, chartName: string): Promise<HelmPackageDetail> {
    const path = `packages/helm/${helmPathSegment(repoName)}/${helmPathSegment(chartName)}`;
    const { ok, status, body } = await hubFetch(path);
    if (status === 404) {
        throw new Error('Chart not found on Artifact Hub.');
    }
    if (!ok) {
        throw new Error(`Artifact Hub package failed (${status})`);
    }
    return parseJson<HelmPackageDetail>(body);
}

export async function fetchHelmPackageVersion(
    repoName: string,
    chartName: string,
    version: string
): Promise<HelmPackageDetail> {
    const path = `packages/helm/${helmPathSegment(repoName)}/${helmPathSegment(chartName)}/${helmPathSegment(version)}`;
    const { ok, status, body } = await hubFetch(path);
    if (status === 404) {
        throw new Error(`Chart version "${version}" not found on Artifact Hub.`);
    }
    if (!ok) {
        throw new Error(`Artifact Hub package version failed (${status})`);
    }
    return parseJson<HelmPackageDetail>(body);
}

export async function fetchHelmChartValuesYaml(packageId: string, version: string): Promise<string> {
    const path = `packages/${packageId}/${helmPathSegment(version)}/values`;
    const { ok, status, body } = await hubFetch(path, {
        accept: 'application/yaml, text/yaml, */*',
    });
    if (status === 404) {
        return '';
    }
    if (!ok) {
        throw new Error(`Artifact Hub values failed (${status})`);
    }
    return body;
}

export async function fetchHelmValuesSchema(packageId: string, version: string): Promise<unknown | null> {
    const path = `packages/${packageId}/${helmPathSegment(version)}/values-schema`;
    const { ok, status, body } = await hubFetch(path);
    if (status === 404) {
        return null;
    }
    if (!ok) {
        return null;
    }
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return null;
    }
}

/** Package changelog as Markdown when the publisher provides it (Artifact Hub). */
export async function fetchHelmChangelogMd(repoName: string, chartName: string): Promise<string> {
    const path = `packages/helm/${helmPathSegment(repoName)}/${helmPathSegment(chartName)}/changelog.md`;
    const { ok, status, body } = await hubFetch(path, { accept: 'text/markdown, text/plain, */*' });
    if (status === 404) {
        return '';
    }
    if (!ok) {
        return '';
    }
    return body;
}
