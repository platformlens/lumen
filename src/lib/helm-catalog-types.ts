import type { ArtifactHubPackage } from './artifacthub';

export interface HelmCatalogPayload {
    version: number;
    sections: HelmCatalogSectionConfig[];
}

export type HelmCatalogSectionConfig =
    | {
          id: string;
          title: string;
          description: string;
          resolve: {
              type: 'search_filter';
              ts_query: string;
              repo_url_contains: string;
              chart_order?: string[];
          };
      }
    | {
          id: string;
          title: string;
          description: string;
          resolve: {
              type: 'search_pick';
              ts_query: string;
              /** Single chart name, unless chart_names is set */
              chart_name?: string;
              chart_names?: string[];
              prefer_repo_name?: string;
              repo_url_contains?: string;
              max: number;
          };
      }
    | {
          id: string;
          title: string;
          description: string;
          resolve: { type: 'exact'; repo: string; chart: string };
      };

/** Public Supabase row shape (table helm_catalog_sections, one row per section). */
export interface HelmCatalogSectionRow {
    section_key: string;
    title: string;
    description: string;
    sort_order: number;
    resolve: HelmCatalogSectionConfig['resolve'];
}

/** PostgREST payload version when assembling {@link HelmCatalogPayload} from rows. */
export const HELM_CATALOG_PAYLOAD_VERSION = 2;

/** Build the in-memory catalog config from `helm_catalog_sections` rows (sorted by sort_order). */
export function rowsToHelmCatalogPayload(rows: HelmCatalogSectionRow[] | null | undefined): HelmCatalogPayload | null {
    if (!rows?.length) return null;
    const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
    const sections = sorted.map(r => ({
        id: r.section_key,
        title: r.title,
        description: r.description,
        resolve: r.resolve,
    })) as HelmCatalogSectionConfig[];
    return { version: HELM_CATALOG_PAYLOAD_VERSION, sections };
}

export interface HelmCatalogSection {
    id: string;
    title: string;
    description: string;
    packages: ArtifactHubPackage[];
}

/** Bundled fallback if Supabase is unreachable (keep in sync with DB rows). */
export const DEFAULT_HELM_CATALOG_PAYLOAD: HelmCatalogPayload = {
    version: HELM_CATALOG_PAYLOAD_VERSION,
    sections: [
        {
            id: 'istio',
            title: 'Istio',
            description:
                'Official Istio charts (base, istiod, gateway, ambient mesh, CNI, ztunnel). Data from Artifact Hub.',
            resolve: {
                type: 'search_filter',
                ts_query: 'istio',
                repo_url_contains: 'istio-release.storage.googleapis.com',
                chart_order: ['base', 'istiod', 'gateway', 'ambient', 'cni', 'ztunnel', 'istiod-remote'],
            },
        },
        {
            id: 'kyverno',
            title: 'Kyverno',
            description: 'Policy engine for Kubernetes.',
            resolve: {
                type: 'search_pick',
                ts_query: 'kyverno',
                chart_name: 'kyverno',
                prefer_repo_name: 'kyverno',
                max: 1,
            },
        },
        {
            id: 'velero',
            title: 'Velero',
            description: 'Cluster backup and restore (VMware Tanzu chart when available).',
            resolve: {
                type: 'search_pick',
                ts_query: 'velero',
                chart_name: 'velero',
                repo_url_contains: 'vmware-tanzu.github.io',
                max: 1,
            },
        },
        {
            id: 'valkey',
            title: 'Valkey',
            description: 'Redis-compatible in-memory store. Multiple publishers on Artifact Hub.',
            resolve: {
                type: 'search_pick',
                ts_query: 'valkey',
                chart_name: 'valkey',
                chart_names: ['valkey', 'valkey-cluster'],
                max: 4,
            },
        },
        {
            id: 'redis',
            title: 'Redis',
            description: 'Common Redis Helm charts (Bitnami and others).',
            resolve: {
                type: 'search_pick',
                ts_query: 'redis',
                chart_names: ['redis', 'redis-cluster'],
                repo_url_contains: 'bitnami',
                max: 2,
            },
        },
        {
            id: 'cert-manager',
            title: 'cert-manager',
            description: 'Automated TLS certificates for Kubernetes (ACME, private CAs).',
            resolve: { type: 'exact', repo: 'cert-manager', chart: 'cert-manager' },
        },
        {
            id: 'coredns',
            title: 'CoreDNS',
            description: 'DNS for Kubernetes clusters and related add-ons.',
            resolve: {
                type: 'search_pick',
                ts_query: 'coredns',
                chart_name: 'coredns',
                prefer_repo_name: 'coredns',
                max: 2,
            },
        },
        {
            id: 'node-local-dns',
            title: 'Node-local DNS cache',
            description:
                'Node-local DNS caching for lower latency and softer load on cluster DNS (node-local-dns).',
            resolve: {
                type: 'search_pick',
                ts_query: 'node-local-dns',
                chart_name: 'node-local-dns',
                max: 3,
            },
        },
        {
            id: 'argo-cd',
            title: 'Argo CD',
            description: 'Declarative GitOps continuous delivery for Kubernetes (Argo Project).',
            resolve: { type: 'exact', repo: 'argo', chart: 'argo-cd' },
        },
        {
            id: 'argo-workflows',
            title: 'Argo Workflows',
            description: 'Container-native workflow engine for Kubernetes (DAGs, steps, artifacts).',
            resolve: { type: 'exact', repo: 'argo', chart: 'argo-workflows' },
        },
        {
            id: 'argo-rollouts',
            title: 'Argo Rollouts',
            description: 'Progressive delivery (canary, blue/green, experiments) for Kubernetes workloads.',
            resolve: { type: 'exact', repo: 'argo', chart: 'argo-rollouts' },
        },
        {
            id: 'flux2',
            title: 'Flux',
            description: 'GitOps toolkit: sync manifests and Helm releases from Git (community bootstrap chart).',
            resolve: { type: 'exact', repo: 'fluxcd-community', chart: 'flux2' },
        },
        {
            id: 'flagger',
            title: 'Flagger',
            description: 'Progressive delivery operator (canary, A/B, Blue/Green) often paired with service mesh or ingress.',
            resolve: { type: 'exact', repo: 'flagger', chart: 'flagger' },
        },
        {
            id: 'linkerd',
            title: 'Linkerd',
            description: 'Ultralight service mesh (install CRDs, then control plane; optional viz from Buoyant charts).',
            resolve: {
                type: 'search_filter',
                ts_query: 'linkerd',
                repo_url_contains: 'helm.linkerd.io',
                chart_order: ['linkerd-crds', 'linkerd-control-plane', 'linkerd-viz'],
            },
        },
        {
            id: 'kube-prometheus-stack',
            title: 'kube-prometheus-stack',
            description: 'Prometheus, Grafana, Alertmanager and common exporters as one chart (prometheus-operator).',
            resolve: { type: 'exact', repo: 'prometheus-community', chart: 'kube-prometheus-stack' },
        },
        {
            id: 'ingress-nginx',
            title: 'ingress-nginx',
            description: 'Ingress controller for NGINX, widely used for HTTP(S) routing into the cluster.',
            resolve: { type: 'exact', repo: 'ingress-nginx', chart: 'ingress-nginx' },
        },
        {
            id: 'traefik',
            title: 'Traefik',
            description: 'Edge proxy and ingress controller with dynamic configuration.',
            resolve: { type: 'exact', repo: 'traefik', chart: 'traefik' },
        },
        {
            id: 'metallb',
            title: 'MetalLB',
            description: 'Bare-metal load-balancer implementation using standard routing protocols.',
            resolve: { type: 'exact', repo: 'metallb', chart: 'metallb' },
        },
        {
            id: 'cilium',
            title: 'Cilium',
            description: 'eBPF-powered networking, observability, and security (CNI, mesh, egress, etc.).',
            resolve: { type: 'exact', repo: 'cilium', chart: 'cilium' },
        },
        {
            id: 'external-dns',
            title: 'ExternalDNS',
            description: 'Syncs DNS records with cloud providers from Services and Ingresses (Kubernetes SIGs chart).',
            resolve: {
                type: 'search_pick',
                ts_query: 'external-dns',
                chart_name: 'external-dns',
                repo_url_contains: 'kubernetes-sigs.github.io/external-dns',
                max: 1,
            },
        },
        {
            id: 'metrics-server',
            title: 'metrics-server',
            description: 'Cluster-wide aggregator of resource metrics (CPU/memory) for kubectl top and HPA.',
            resolve: { type: 'exact', repo: 'metrics-server', chart: 'metrics-server' },
        },
        {
            id: 'external-secrets',
            title: 'External Secrets Operator',
            description: 'Sync secrets from external vaults (AWS, GCP, Vault, etc.) into Kubernetes Secrets.',
            resolve: { type: 'exact', repo: 'external-secrets-operator', chart: 'external-secrets' },
        },
        {
            id: 'sealed-secrets',
            title: 'Sealed Secrets',
            description: 'Encrypt Secrets into SealedSecret resources safe to store in Git.',
            resolve: { type: 'exact', repo: 'bitnami-labs', chart: 'sealed-secrets' },
        },
        {
            id: 'crossplane',
            title: 'Crossplane',
            description: 'Control plane to provision cloud APIs and infrastructure from Kubernetes (XRDs, compositions).',
            resolve: { type: 'exact', repo: 'crossplane', chart: 'crossplane' },
        },
        {
            id: 'keda',
            title: 'KEDA',
            description: 'Event-driven autoscaling for Deployments, Jobs, and custom metrics.',
            resolve: { type: 'exact', repo: 'kedacore', chart: 'keda' },
        },
        {
            id: 'vault',
            title: 'Vault',
            description: 'HashiCorp Vault on Kubernetes (secrets, encryption, PKI).',
            resolve: { type: 'exact', repo: 'hashicorp', chart: 'vault' },
        },
        {
            id: 'minio',
            title: 'MinIO',
            description: 'S3-compatible object storage for Kubernetes.',
            resolve: { type: 'exact', repo: 'minio', chart: 'minio' },
        },
        {
            id: 'longhorn',
            title: 'Longhorn',
            description: 'Distributed block storage for Kubernetes (CNCF).',
            resolve: { type: 'exact', repo: 'longhorn', chart: 'longhorn' },
        },
        {
            id: 'rook-ceph',
            title: 'Rook Ceph',
            description: 'Ceph storage orchestrated by the Rook operator (block, file, object).',
            resolve: { type: 'exact', repo: 'rook', chart: 'rook-ceph' },
        },
        {
            id: 'harbor',
            title: 'Harbor',
            description: 'Cloud native registry: OCI artifacts, signing, scanning (CNCF).',
            resolve: { type: 'exact', repo: 'harbor', chart: 'harbor' },
        },
        {
            id: 'jaeger',
            title: 'Jaeger',
            description: 'Distributed tracing backend (OpenTelemetry and Jaeger clients).',
            resolve: { type: 'exact', repo: 'jaegertracing', chart: 'jaeger' },
        },
        {
            id: 'loki',
            title: 'Grafana Loki',
            description: 'Horizontally scalable log aggregation inspired by Prometheus labels.',
            resolve: { type: 'exact', repo: 'grafana', chart: 'loki' },
        },
        {
            id: 'tempo',
            title: 'Grafana Tempo',
            description: 'High-scale distributed tracing backend, often paired with Grafana.',
            resolve: { type: 'exact', repo: 'grafana', chart: 'tempo' },
        },
        {
            id: 'strimzi-kafka',
            title: 'Strimzi Kafka',
            description: 'Apache Kafka on Kubernetes via the Strimzi operator.',
            resolve: { type: 'exact', repo: 'strimzi', chart: 'strimzi-kafka-operator' },
        },
        {
            id: 'opentelemetry-operator',
            title: 'OpenTelemetry Operator',
            description: 'Manage OpenTelemetry collectors and instrumentation on Kubernetes.',
            resolve: { type: 'exact', repo: 'opentelemetry-helm', chart: 'opentelemetry-operator' },
        },
        {
            id: 'kong',
            title: 'Kong',
            description: 'API gateway and ingress built on Kong Gateway.',
            resolve: { type: 'exact', repo: 'kong', chart: 'kong' },
        },
        {
            id: 'aws-load-balancer-controller',
            title: 'AWS Load Balancer Controller',
            description: 'AWS ELB integration for Ingress and Service type LoadBalancer on EKS.',
            resolve: { type: 'exact', repo: 'aws', chart: 'aws-load-balancer-controller' },
        },
        {
            id: 'cloudnative-pg',
            title: 'CloudNativePG',
            description: 'PostgreSQL operator for high availability clusters on Kubernetes.',
            resolve: { type: 'exact', repo: 'cloudnative-pg', chart: 'cloudnative-pg' },
        },
        {
            id: 'reloader',
            title: 'Reloader',
            description: 'Watch ConfigMaps and Secrets and roll pods when linked data changes.',
            resolve: { type: 'exact', repo: 'stakater', chart: 'reloader' },
        },
    ],
};

function parseJson<T>(raw: string): T {
    return JSON.parse(raw) as T;
}

function helmEnc(s: string): string {
    return encodeURIComponent(s);
}

export type HubFetchFn = (
    pathAndQuery: string,
    options?: { accept?: string }
) => Promise<{ ok: boolean; status: number; body: string }>;

async function hubSearchPackages(fetchHub: HubFetchFn, tsQuery: string, limit: number): Promise<ArtifactHubPackage[]> {
    const params = new URLSearchParams({
        offset: '0',
        limit: String(limit),
        kind: '0',
        ts_query: tsQuery,
    });
    const { ok, status, body } = await fetchHub(`packages/search?${params}`);
    if (!ok) throw new Error(`Artifact Hub search failed (${status})`);
    const data = parseJson<{ packages?: ArtifactHubPackage[] }>(body);
    return data.packages ?? [];
}

async function hubGetExactPackage(fetchHub: HubFetchFn, repo: string, chart: string): Promise<ArtifactHubPackage> {
    const path = `packages/helm/${helmEnc(repo)}/${helmEnc(chart)}`;
    const { ok, status, body } = await fetchHub(path);
    if (status === 404) throw new Error(`Chart not found: ${repo}/${chart}`);
    if (!ok) throw new Error(`Artifact Hub package failed (${status})`);
    const d = parseJson<{
        package_id: string;
        name: string;
        description: string;
        version: string;
        app_version?: string;
        deprecated?: boolean;
        repository: ArtifactHubPackage['repository'];
    }>(body);
    return {
        package_id: d.package_id,
        name: d.name,
        description: d.description,
        version: d.version,
        app_version: d.app_version,
        deprecated: d.deprecated,
        repository: d.repository,
    };
}

function sortByChartOrder(packages: ArtifactHubPackage[], order: string[] | undefined): ArtifactHubPackage[] {
    if (!order?.length) return packages;
    return [...packages].sort((a, b) => {
        const ia = order.indexOf(a.name);
        const ib = order.indexOf(b.name);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
}

/**
 * Expand remote (or default) catalog config into sections with Artifact Hub package rows.
 */
export async function resolveHelmCatalogSections(
    payload: HelmCatalogPayload,
    fetchHub: HubFetchFn
): Promise<HelmCatalogSection[]> {
    const out: HelmCatalogSection[] = [];

    for (const sec of payload.sections) {
        let packages: ArtifactHubPackage[] = [];
        const { resolve: r } = sec;

        if (r.type === 'exact') {
            packages = [await hubGetExactPackage(fetchHub, r.repo, r.chart)];
        } else if (r.type === 'search_filter') {
            const all = await hubSearchPackages(fetchHub, r.ts_query, 50);
            const filtered = all.filter(p => p.repository?.url?.includes(r.repo_url_contains));
            packages = sortByChartOrder(filtered, r.chart_order);
        } else if (r.type === 'search_pick') {
            const all = await hubSearchPackages(fetchHub, r.ts_query, 30);
            const names =
                r.chart_names?.length ? r.chart_names : r.chart_name ? [r.chart_name] : [];
            let candidates = names.length ? all.filter(p => names.includes(p.name)) : [];
            if (r.prefer_repo_name) {
                const pref = candidates.filter(p => p.repository?.name === r.prefer_repo_name);
                if (pref.length) candidates = pref;
            }
            if (r.repo_url_contains) {
                const urlSub = r.repo_url_contains;
                const pref = candidates.filter(p => p.repository?.url?.includes(urlSub));
                if (pref.length) candidates = pref;
            }
            const seen = new Set<string>();
            for (const p of candidates) {
                const k = `${p.repository?.url ?? ''}::${p.name}`;
                if (seen.has(k)) continue;
                seen.add(k);
                packages.push(p);
                if (packages.length >= r.max) break;
            }
            if (packages.length === 0 && names.length) {
                const fallback = all.find(p => names.includes(p.name));
                if (fallback) packages = [fallback];
            }
        }

        out.push({
            id: sec.id,
            title: sec.title,
            description: sec.description,
            packages,
        });
    }

    return out;
}
