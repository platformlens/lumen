/**
 * Fetch machinery for the Deployment Full View aggregator (split from deployment-full-details.ts):
 * error classification, per-call settle, bounded concurrency, and the per-object read fetchers
 * (nodes, PVCs) with their mappers. Never calls Secret APIs; never logs object contents.
 */
import type {
    CoreV1Api, V1Node, V1ServiceAccount, V1PersistentVolumeClaim,
} from '@kubernetes/client-node';
import { withTimeout } from '../src/lib/with-timeout';
import type {
    SectionResult, DeploymentPodSummary, NodeSummary, ServiceAccountSummary, PvcSummary,
} from '../src/types/deployment-details';

type ErrorClass = 'unauthorized' | 'forbidden' | 'not-found' | 'timeout' | 'other';

const SECTION_TIMEOUT_MS = 15000;
const NODE_READ_TIMEOUT_MS = 10000;
const NODES_DEADLINE_MS = 20000;
export const CONCURRENCY = 8;
const MAX_NODES = 100;
const MAX_PVCS = 50;
export const LOG_PREFIX = '[k8s] deploymentFullDetails';

// --- Error handling ---

function errorStatus(err: unknown): number | undefined {
    if (!err || typeof err !== 'object') return undefined;
    const e = err as { code?: unknown; statusCode?: unknown; response?: { statusCode?: unknown } };
    for (const s of [e.code, e.statusCode, e.response?.statusCode]) {
        if (typeof s === 'number') return s;
    }
    return undefined;
}

function rawMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
        return (err as { message: string }).message;
    }
    return String(err);
}

/** Short human message: the Kubernetes Status message when present, else the first line of the error. */
export function shortMessage(err: unknown): string {
    let body = err && typeof err === 'object' ? (err as { body?: unknown }).body : undefined;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { /* not JSON */ }
    }
    const statusMsg = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
    const msg = typeof statusMsg === 'string' ? statusMsg : rawMessage(err).split('\n')[0];
    return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

export function classifyK8sError(err: unknown): ErrorClass {
    const status = errorStatus(err);
    if (status === 401) return 'unauthorized';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not-found';
    const message = rawMessage(err);
    // Mirrors K8sService.is401Error so message-only 401s (exec-plugin failures) still reach withAuthRetry.
    if (/\b401\b|Unauthorized/.test(message)) return 'unauthorized';
    if (/timed out/i.test(message)) return 'timeout';
    return 'other';
}

export interface SettleOptions<T> {
    timeoutMs?: number;                         // default 15000
    onNotFound?: () => SectionResult<T>;        // called when classifyK8sError(err) === 'not-found'
}

/** Settles one API call (plus its synchronous mapping) into a SectionResult. Rethrows 401s. */
export async function settle<T>(p: Promise<T>, label: string, opts?: SettleOptions<T>): Promise<SectionResult<T>> {
    try {
        const data = await withTimeout(p, opts?.timeoutMs ?? SECTION_TIMEOUT_MS, label);
        return { status: 'ok', data };
    } catch (err) {
        const cls = classifyK8sError(err);
        if (cls === 'unauthorized') throw err;
        let result: SectionResult<T>;
        switch (cls) {
            case 'forbidden': result = { status: 'forbidden', message: `${label}: forbidden` }; break;
            case 'not-found':
                result = opts?.onNotFound?.() ?? { status: 'error', message: `${label}: not found (API not available?)` };
                break;
            case 'timeout': result = { status: 'error', message: `${label}: timed out` }; break;
            default: result = { status: 'error', message: `${label}: ${shortMessage(err)}` };
        }
        if (result.status !== 'ok') console.warn(`${LOG_PREFIX} ${label}: ${cls} ${result.message}`);
        return result;
    }
}

/** Runs `fn` over items with at most `limit` in flight. Once shouldStop() is true no new item starts. */
export async function mapWithConcurrency<I, O>(
    items: I[], limit: number, fn: (i: I) => Promise<O>, shouldStop?: () => boolean,
): Promise<(O | undefined)[]> {
    const results: (O | undefined)[] = new Array<O | undefined>(items.length).fill(undefined);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            if (shouldStop?.()) return;
            const idx = next++;
            results[idx] = await fn(items[idx]);
        }
    };
    await Promise.all(Array.from({ length: Math.max(0, Math.min(limit, items.length)) }, worker));
    return results;
}

/** Aggregates per-item results: all forbidden -> forbidden, all failed -> error, some failed -> ok + note. */
function aggregate<T>(results: (SectionResult<T> | undefined)[], noun: string, forbiddenMessage: string): SectionResult<T[]> {
    const ok: T[] = [];
    const failed: { status: 'forbidden' | 'error'; message: string }[] = [];
    for (const r of results) {
        if (r?.status === 'ok') ok.push(r.data);
        else if (r) failed.push(r);
    }
    if (failed.length > 0 && ok.length === 0) {
        if (failed.every(r => r.status === 'forbidden')) return { status: 'forbidden', message: forbiddenMessage };
        return { status: 'error', message: failed[0].message };
    }
    if (failed.length > 0) {
        const note = `${failed.length} of ${results.length} ${noun} reads failed`;
        console.warn(`${LOG_PREFIX} ${noun}s: partial ${note}`);
        return { status: 'ok', data: ok, note };
    }
    return { status: 'ok', data: ok };
}

// --- Mappers ---

export function summarizeNode(node: V1Node): NodeSummary {
    const labels = node.metadata?.labels ?? {};
    const info = node.status?.nodeInfo;
    const alloc = node.status?.allocatable ?? {};
    return {
        name: node.metadata?.name ?? '',
        ready: node.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True') ?? false,
        unschedulable: node.spec?.unschedulable === true,
        hostname: labels['kubernetes.io/hostname'] ?? null,
        zone: labels['topology.kubernetes.io/zone'] ?? labels['failure-domain.beta.kubernetes.io/zone'] ?? null,
        region: labels['topology.kubernetes.io/region'] ?? null,
        instanceType: labels['node.kubernetes.io/instance-type'] ?? labels['beta.kubernetes.io/instance-type'] ?? null,
        capacityType: labels['karpenter.sh/capacity-type'] ?? labels['eks.amazonaws.com/capacityType'] ?? null,
        nodePool: labels['karpenter.sh/nodepool'] ?? labels['eks.amazonaws.com/nodegroup'] ?? null,
        arch: labels['kubernetes.io/arch'] ?? info?.architecture ?? null,
        os: labels['kubernetes.io/os'] ?? info?.operatingSystem ?? null,
        kubeletVersion: info?.kubeletVersion ?? null,
        taints: (node.spec?.taints ?? []).map(t => ({ key: t.key, value: t.value ?? null, effect: t.effect })),
        allocatable: { cpu: alloc.cpu ?? null, memory: alloc.memory ?? null, pods: alloc.pods ?? null },
    };
}

/** Never copies `secrets`. */
export function toSaSummary(sa: V1ServiceAccount): ServiceAccountSummary {
    return {
        name: sa.metadata?.name ?? '',
        exists: true,
        automountServiceAccountToken: sa.automountServiceAccountToken ?? null,
        imagePullSecretNames: (sa.imagePullSecrets ?? []).map(s => s.name).filter((n): n is string => !!n),
        irsaRoleArn: sa.metadata?.annotations?.['eks.amazonaws.com/role-arn'] ?? null,
    };
}

export function toPvcSummary(pvc: V1PersistentVolumeClaim): PvcSummary {
    return {
        claimName: pvc.metadata?.name ?? '',
        found: true,
        phase: pvc.status?.phase ?? null,
        storageClass: pvc.spec?.storageClassName ?? null,
        capacity: pvc.status?.capacity?.storage ?? null,
        accessModes: pvc.status?.accessModes ?? pvc.spec?.accessModes ?? [],
        volumeName: pvc.spec?.volumeName ?? null,
    };
}

// --- Per-object read fetchers ---

/** Reads the unique claims (cap 50); a 404 claim is ok with found:false. */
export async function fetchPvcs(core: CoreV1Api, namespace: string, claimNames: string[]): Promise<SectionResult<PvcSummary[]>> {
    const claims = [...new Set(claimNames)].slice(0, MAX_PVCS);
    const results = await mapWithConcurrency(claims, CONCURRENCY, c =>
        settle(core.readNamespacedPersistentVolumeClaim({ name: c, namespace }).then(toPvcSummary), 'pvc',
            { onNotFound: () => ({ status: 'ok', data: { claimName: c, found: false, phase: null, storageClass: null,
                capacity: null, accessModes: [], volumeName: null } }) }));
    return aggregate(results, 'PVC', 'pvcs: forbidden');
}

/**
 * Reads only the nodes hosting the given pods (cap 100): concurrency 8, 10 s per read, 20 s overall deadline
 * that also stops new reads, and a stop on the first 403. In-flight reads at the deadline are discarded.
 */
export async function fetchNodes(core: CoreV1Api, pods: DeploymentPodSummary[]): Promise<SectionResult<NodeSummary[]>> {
    const nodeNames = [...new Set(pods.map(p => p.nodeName).filter((n): n is string => !!n))].slice(0, MAX_NODES);
    let sawForbidden = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; }, NODES_DEADLINE_MS);
    try {
        const results = await withTimeout(mapWithConcurrency(nodeNames, CONCURRENCY, async n => {
            const r = await settle(core.readNode({ name: n }).then(summarizeNode), 'node', { timeoutMs: NODE_READ_TIMEOUT_MS });
            if (r.status === 'forbidden') sawForbidden = true;
            return r;
        }, () => sawForbidden || timedOut), NODES_DEADLINE_MS, 'nodes');
        if (sawForbidden) return { status: 'forbidden', message: 'No permission to read nodes' };
        return aggregate(results, 'node', 'No permission to read nodes');
    } catch (err) {
        const cls = classifyK8sError(err);
        if (cls === 'unauthorized') throw err;
        console.warn(`${LOG_PREFIX} nodes: ${cls}`);
        if (timedOut || cls === 'timeout') return { status: 'error', message: 'Timed out reading nodes' };
        return { status: 'error', message: `nodes: ${shortMessage(err)}` };
    } finally {
        clearTimeout(timer);
    }
}
