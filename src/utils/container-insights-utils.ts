/**
 * Per-container insights for the Deployment Full View: image parsing, ports, env (masked),
 * mounts, resources, probes, lifecycle hooks and best-practice flags.
 */
import type { V1Container } from '@kubernetes/client-node';
import type { DeploymentPodSummary, Jsonified, PodTemplate } from '../types/deployment-details';
import { isSensitiveEnv, MASK } from './sensitive-value-utils';

export interface ParsedImage {
    raw: string; registry: string | null; repository: string; tag: string | null;
    digest: string | null; isLatest: boolean; isUntagged: boolean;
}
export interface EnvEntry {
    name: string; source: 'literal' | 'configMapKeyRef' | 'secretKeyRef' | 'fieldRef' | 'resourceFieldRef';
    display: string; masked: boolean; refName: string | null; refKey: string | null; optional: boolean;
}
export interface ProbeSummary {
    handler: 'httpGet' | 'tcpSocket' | 'exec' | 'grpc' | 'unknown'; target: string;
    initialDelaySeconds: number; periodSeconds: number; timeoutSeconds: number; failureThreshold: number; successThreshold: number;
}
export interface ContainerFlag { id: string; level: 'info' | 'warn' | 'fail'; message: string }
export interface ContainerInsight {
    name: string; kind: 'init' | 'sidecar' | 'main'; image: ParsedImage; effectivePullPolicy: string;
    runningImageIDs: string[];      // distinct imageIDs from pod container statuses (actual digests)
    command: string[]; args: string[]; workingDir: string | null;
    ports: { name: string | null; containerPort: number; protocol: string; hostPort: number | null }[];
    env: EnvEntry[]; envFrom: { kind: 'configMap' | 'secret'; name: string; prefix: string | null; optional: boolean }[];
    volumeMounts: { name: string; mountPath: string; subPath: string | null; readOnly: boolean; volumeType: string }[];
    resources: { requests: Record<string, string>; limits: Record<string, string> };
    probes: { liveness: ProbeSummary | null; readiness: ProbeSummary | null; startup: ProbeSummary | null };
    lifecycle: { postStart: string | null; preStop: string | null };
    flags: ContainerFlag[];
}

type Container = Jsonified<V1Container>;
type PortList = ContainerInsight['ports'];

/** Splits an image reference into registry / repository / tag / digest. */
export function parseImageRef(ref: string): ParsedImage {
    const raw = ref ?? '';
    let rest = raw.trim();
    let digest: string | null = null;
    const at = rest.indexOf('@');
    if (at >= 0) {
        digest = rest.slice(at + 1) || null;
        rest = rest.slice(0, at);
    }
    let registry: string | null = null;
    const slash = rest.indexOf('/');
    if (slash > 0) {
        const first = rest.slice(0, slash);
        if (first.includes('.') || first.includes(':') || first === 'localhost') {
            registry = first;
            rest = rest.slice(slash + 1);
        }
    }
    let tag: string | null = null;
    const colon = rest.lastIndexOf(':');
    if (colon > rest.lastIndexOf('/')) {
        tag = rest.slice(colon + 1) || null;
        rest = rest.slice(0, colon);
    }
    return {
        raw, registry, repository: rest, tag, digest,
        isLatest: tag === 'latest',
        isUntagged: tag === null && digest === null,
    };
}

/** The volume source type of a pod volume (`configMap`, `hostPath`, `nfs`, …), or 'unknown'. */
export function volumeTypeOf(volume: Record<string, unknown> | null | undefined): string {
    if (!volume) return 'unknown';
    return Object.keys(volume).find(k => k !== 'name' && volume[k] != null) ?? 'unknown';
}

interface HandlerLike {
    httpGet?: { path?: string; port?: number | string; host?: string; scheme?: string };
    tcpSocket?: { port?: number | string; host?: string };
    exec?: { command?: string[] };
    grpc?: { port?: number; service?: string };
    sleep?: { seconds?: number };
}

function resolvePort(port: number | string | undefined, ports: PortList): string {
    if (port === undefined || port === null) return '';
    if (typeof port === 'number') return String(port);
    const named = ports.find(p => p.name === port);
    return named ? String(named.containerPort) : port;
}

function describeHandler(h: HandlerLike, ports: PortList): { handler: ProbeSummary['handler'] | 'sleep'; target: string } {
    if (h.httpGet) {
        const scheme = (h.httpGet.scheme ?? 'HTTP').toLowerCase();
        return { handler: 'httpGet', target: `GET ${scheme}://${h.httpGet.host ?? ''}:${resolvePort(h.httpGet.port, ports)}${h.httpGet.path ?? '/'}` };
    }
    if (h.tcpSocket) return { handler: 'tcpSocket', target: `TCP ${h.tcpSocket.host ?? ''}:${resolvePort(h.tcpSocket.port, ports)}` };
    if (h.exec) return { handler: 'exec', target: `exec: ${(h.exec.command ?? []).join(' ')}` };
    if (h.grpc) return { handler: 'grpc', target: `gRPC :${h.grpc.port ?? ''}${h.grpc.service ? ` (${h.grpc.service})` : ''}` };
    if (h.sleep) return { handler: 'sleep', target: `sleep ${h.sleep.seconds ?? 0}s` };
    return { handler: 'unknown', target: '' };
}

/** Summarizes a probe; named ports are resolved against the container's ports. */
export function describeProbe(probe: unknown, ports: ContainerInsight['ports']): ProbeSummary | null {
    if (!probe || typeof probe !== 'object') return null;
    const p = probe as HandlerLike & {
        initialDelaySeconds?: number; periodSeconds?: number; timeoutSeconds?: number;
        failureThreshold?: number; successThreshold?: number;
    };
    const { handler, target } = describeHandler(p, ports);
    return {
        handler: handler === 'sleep' ? 'unknown' : handler, target,
        initialDelaySeconds: p.initialDelaySeconds ?? 0,
        periodSeconds: p.periodSeconds ?? 10,
        timeoutSeconds: p.timeoutSeconds ?? 1,
        failureThreshold: p.failureThreshold ?? 3,
        successThreshold: p.successThreshold ?? 1,
    };
}

function describeLifecycleHook(hook: unknown, ports: PortList): string | null {
    if (!hook || typeof hook !== 'object') return null;
    return describeHandler(hook as HandlerLike, ports).target || null;
}

function effectivePullPolicy(explicit: string | undefined, image: ParsedImage): string {
    if (explicit) return explicit;
    if (image.digest) return 'IfNotPresent';
    return image.tag === null || image.isLatest ? 'Always' : 'IfNotPresent';
}

function toEnvEntry(e: NonNullable<Container['env']>[number]): EnvEntry {
    const base = { name: e.name, masked: false, refName: null, refKey: null, optional: false };
    const vf = e.valueFrom;
    if (vf?.secretKeyRef) {
        return { ...base, source: 'secretKeyRef', display: `secret ${vf.secretKeyRef.name ?? ''} / ${vf.secretKeyRef.key}`,
            refName: vf.secretKeyRef.name ?? null, refKey: vf.secretKeyRef.key, optional: vf.secretKeyRef.optional === true };
    }
    if (vf?.configMapKeyRef) {
        return { ...base, source: 'configMapKeyRef', display: `configmap ${vf.configMapKeyRef.name ?? ''} / ${vf.configMapKeyRef.key}`,
            refName: vf.configMapKeyRef.name ?? null, refKey: vf.configMapKeyRef.key, optional: vf.configMapKeyRef.optional === true };
    }
    if (vf?.fieldRef) return { ...base, source: 'fieldRef', display: vf.fieldRef.fieldPath };
    if (vf?.resourceFieldRef) {
        const r = vf.resourceFieldRef;
        return { ...base, source: 'resourceFieldRef', display: r.containerName ? `${r.resource} (${r.containerName})` : r.resource };
    }
    const value = e.value ?? '';
    const masked = isSensitiveEnv(e.name, value);
    return { ...base, source: 'literal', display: masked ? MASK : value, masked };
}

function stringifyQuantities(q: Record<string, unknown> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null) out[k] = String(v);
    return out;
}

function buildFlags(insight: Omit<ContainerInsight, 'flags'>): ContainerFlag[] {
    const flags: ContainerFlag[] = [];
    const { image, resources, probes, kind } = insight;
    if (image.isLatest) flags.push({ id: 'latest-tag', level: 'warn', message: 'Image uses the :latest tag (not reproducible)' });
    if (image.isUntagged) flags.push({ id: 'no-tag', level: 'warn', message: 'Image has no tag or digest (implies :latest)' });
    if (!resources.requests.cpu) flags.push({ id: 'no-requests-cpu', level: 'warn', message: 'No CPU request' });
    if (!resources.requests.memory) flags.push({ id: 'no-requests-memory', level: 'warn', message: 'No memory request' });
    if (!resources.limits.memory) flags.push({ id: 'no-limits-memory', level: 'warn', message: 'No memory limit' });
    if (!resources.limits.cpu) flags.push({ id: 'no-limits-cpu', level: 'info', message: 'No CPU limit (often deliberate)' });
    if (kind === 'main') {
        if (!probes.readiness) flags.push({ id: 'no-readiness', level: 'warn', message: 'No readiness probe' });
        if (!probes.liveness) flags.push({ id: 'no-liveness', level: 'warn', message: 'No liveness probe' });
        if (!probes.startup) flags.push({ id: 'no-startup', level: 'info', message: 'No startup probe' });
    }
    if (probes.liveness && probes.readiness && probes.liveness.handler === probes.readiness.handler
        && probes.liveness.target === probes.readiness.target) {
        flags.push({ id: 'liveness-equals-readiness', level: 'info', message: 'Liveness and readiness probes check the same endpoint' });
    }
    if (insight.effectivePullPolicy === 'Never') flags.push({ id: 'pull-never', level: 'info', message: 'imagePullPolicy is Never' });
    if (insight.runningImageIDs.length > 1) {
        flags.push({ id: 'multiple-digests', level: 'warn', message: `Pods run ${insight.runningImageIDs.length} different image digests` });
    }
    return flags;
}

function buildInsight(c: Container, kind: ContainerInsight['kind'], template: PodTemplate,
    pods: DeploymentPodSummary[] | null): ContainerInsight {
    const image = parseImageRef(c.image ?? '');
    const ports: PortList = (c.ports ?? []).map(p => ({
        name: p.name ?? null, containerPort: p.containerPort, protocol: p.protocol ?? 'TCP',
        hostPort: typeof p.hostPort === 'number' && p.hostPort > 0 ? p.hostPort : null,
    }));
    const volumes = template.spec?.volumes ?? [];
    const runningImageIDs = new Set<string>();
    for (const pod of pods ?? []) {
        for (const s of pod.containers) if (s.name === c.name && s.imageID) runningImageIDs.add(s.imageID);
    }
    const base: Omit<ContainerInsight, 'flags'> = {
        name: c.name, kind, image,
        effectivePullPolicy: effectivePullPolicy(c.imagePullPolicy, image),
        runningImageIDs: [...runningImageIDs],
        command: c.command ?? [], args: c.args ?? [], workingDir: c.workingDir ?? null,
        ports,
        env: (c.env ?? []).map(toEnvEntry),
        envFrom: (c.envFrom ?? []).flatMap((ef): ContainerInsight['envFrom'] => {
            const prefix = ef.prefix ?? null;
            if (ef.configMapRef) return [{ kind: 'configMap' as const, name: ef.configMapRef.name ?? '', prefix, optional: ef.configMapRef.optional === true }];
            if (ef.secretRef) return [{ kind: 'secret' as const, name: ef.secretRef.name ?? '', prefix, optional: ef.secretRef.optional === true }];
            return [];
        }),
        volumeMounts: (c.volumeMounts ?? []).map(m => ({
            name: m.name, mountPath: m.mountPath, subPath: m.subPath || m.subPathExpr || null, readOnly: m.readOnly === true,
            volumeType: volumeTypeOf(volumes.find(v => v.name === m.name) as Record<string, unknown> | undefined),
        })),
        resources: {
            requests: stringifyQuantities(c.resources?.requests as Record<string, unknown> | undefined),
            limits: stringifyQuantities(c.resources?.limits as Record<string, unknown> | undefined),
        },
        probes: {
            liveness: describeProbe(c.livenessProbe, ports),
            readiness: describeProbe(c.readinessProbe, ports),
            startup: describeProbe(c.startupProbe, ports),
        },
        lifecycle: {
            postStart: describeLifecycleHook(c.lifecycle?.postStart, ports),
            preStop: describeLifecycleHook(c.lifecycle?.preStop, ports),
        },
    };
    return { ...base, flags: buildFlags(base) };
}

/** Insights for every container in the template: init containers (init or sidecar) first, then main containers. */
export function buildContainerInsights(template: PodTemplate, pods: DeploymentPodSummary[] | null): ContainerInsight[] {
    const init = (template.spec?.initContainers ?? []).map(c =>
        buildInsight(c, c.restartPolicy === 'Always' ? 'sidecar' : 'init', template, pods));
    const main = (template.spec?.containers ?? []).map(c => buildInsight(c, 'main', template, pods));
    return [...init, ...main];
}
