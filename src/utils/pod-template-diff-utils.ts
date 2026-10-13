/**
 * Field-level diff between two pod templates (ReplicaSet revisions).
 * Comparison uses raw values; displayed before/after strings mask sensitive env literals.
 */
import type { V1Container, V1EnvVar } from '@kubernetes/client-node';
import type { Jsonified, PodTemplate } from '../types/deployment-details';
import { isSensitiveEnv, MASK } from './sensitive-value-utils';

export type ChangeKind = 'added' | 'removed' | 'changed';
export interface TemplateChange {
    kind: ChangeKind; scope: 'pod' | 'container';
    container: string | null; containerKind: 'init' | 'sidecar' | 'main' | null;
    field: string;          // "image", "env.FOO", "resources.limits.memory", "volumes.cache"
    label: string;          // "image app: v1 → v2", "env FOO added", "resources.limits.memory app: 256Mi → 512Mi"
    before: string | null; after: string | null;   // display strings; sensitive env literals already masked
}

type Container = Jsonified<V1Container>;
type EnvVar = Jsonified<V1EnvVar>;
type ContainerKind = 'init' | 'sidecar' | 'main';

const POD_TEMPLATE_HASH = 'pod-template-hash';
const RESTARTED_AT = 'kubectl.kubernetes.io/restartedAt';

/** JSON with sorted object keys so equal structures always serialize identically. */
function stableStringify(v: unknown): string {
    if (v === undefined) return 'undefined';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
    const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`).join(',')}}`;
}

/** Display form of an arbitrary value; null when unset. */
function show(v: unknown): string | null {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return stableStringify(v);
}

/** Treats empty arrays/objects as unset so `[]` vs undefined doesn't show as a change. */
function isUnset(v: unknown): boolean {
    if (v === undefined || v === null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v as object).length === 0;
    return false;
}

interface Ctx { scope: 'pod' | 'container'; container: string | null; containerKind: ContainerKind | null }

class ChangeCollector {
    readonly changes: TemplateChange[] = [];

    push(ctx: Ctx, kind: ChangeKind, field: string, label: string, before: string | null, after: string | null): void {
        this.changes.push({ kind, scope: ctx.scope, container: ctx.container, containerKind: ctx.containerKind, field, label, before, after });
    }

    /** Generic comparison of two raw values; labels as `<field> <container>: before → after`. */
    value(ctx: Ctx, field: string, rawBefore: unknown, rawAfter: unknown): void {
        const bUnset = isUnset(rawBefore);
        const aUnset = isUnset(rawAfter);
        if (bUnset && aUnset) return;
        if (!bUnset && !aUnset && stableStringify(rawBefore) === stableStringify(rawAfter)) return;
        const before = bUnset ? null : show(rawBefore);
        const after = aUnset ? null : show(rawAfter);
        const subject = ctx.container ? `${field} ${ctx.container}` : field;
        if (before === null) this.push(ctx, 'added', field, `${subject} added: ${after}`, null, after);
        else if (after === null) this.push(ctx, 'removed', field, `${subject} removed (was ${before})`, before, null);
        else this.push(ctx, 'changed', field, `${subject}: ${before} → ${after}`, before, after);
    }

    /** Compares two keyed collections entry by entry. */
    keyed<T>(ctx: Ctx, prefix: string, before: Map<string, T>, after: Map<string, T>): void {
        const keys = new Set([...before.keys(), ...after.keys()]);
        for (const k of keys) this.value(ctx, `${prefix}.${k}`, before.get(k), after.get(k));
    }
}

function toMap<T>(items: T[] | undefined, keyOf: (item: T) => string): Map<string, T> {
    const m = new Map<string, T>();
    for (const item of items ?? []) m.set(keyOf(item), item);
    return m;
}

function recordToMap(r: Record<string, string> | undefined, skip?: string[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(r ?? {})) {
        if (skip?.includes(k)) continue;
        m.set(k, v);
    }
    return m;
}

/** Raw comparison value for an env var: the literal, or the ref target for valueFrom. */
function envRaw(e: EnvVar): { literal: string | null; display: string } {
    const vf = e.valueFrom;
    if (!vf) return { literal: e.value ?? '', display: e.value ?? '' };
    if (vf.configMapKeyRef) return { literal: null, display: `configmap ${vf.configMapKeyRef.name ?? ''}/${vf.configMapKeyRef.key}` };
    if (vf.secretKeyRef) return { literal: null, display: `secret ${vf.secretKeyRef.name ?? ''}/${vf.secretKeyRef.key}` };
    if (vf.fieldRef) return { literal: null, display: `field ${vf.fieldRef.fieldPath}` };
    if (vf.resourceFieldRef) return { literal: null, display: `resource ${vf.resourceFieldRef.resource}` };
    return { literal: null, display: stableStringify(vf) };
}

function diffEnv(c: ChangeCollector, ctx: Ctx, before: EnvVar[] | undefined, after: EnvVar[] | undefined): void {
    const b = toMap(before, e => e.name);
    const a = toMap(after, e => e.name);
    const names = new Set([...b.keys(), ...a.keys()]);
    for (const name of names) {
        const be = b.get(name);
        const ae = a.get(name);
        const br = be ? envRaw(be) : null;
        const ar = ae ? envRaw(ae) : null;
        const field = `env.${name}`;
        const sensitive = (br?.literal != null && isSensitiveEnv(name, br.literal))
            || (ar?.literal != null && isSensitiveEnv(name, ar.literal));
        const disp = (r: { literal: string | null; display: string }) => (sensitive ? MASK : r.display);
        if (br && !ar) c.push(ctx, 'removed', field, `env ${name} removed`, disp(br), null);
        else if (!br && ar) c.push(ctx, 'added', field, `env ${name} added`, null, disp(ar));
        else if (br && ar && (br.literal !== ar.literal || br.display !== ar.display)) {
            const label = sensitive ? `env ${name} changed (value hidden)` : `env ${name}: ${br.display} → ${ar.display}`;
            c.push(ctx, 'changed', field, label, disp(br), disp(ar));
        }
    }
}

function diffContainer(c: ChangeCollector, ctx: Ctx, b: Container, a: Container): void {
    c.value(ctx, 'image', b.image, a.image);
    c.value(ctx, 'imagePullPolicy', b.imagePullPolicy, a.imagePullPolicy);
    c.value(ctx, 'command', b.command, a.command);
    c.value(ctx, 'args', b.args, a.args);
    c.value(ctx, 'workingDir', b.workingDir, a.workingDir);
    diffEnv(c, ctx, b.env, a.env);
    const envFromKey = (e: NonNullable<Container['envFrom']>[number]) =>
        e.configMapRef ? `configMap:${e.configMapRef.name ?? ''}` : e.secretRef ? `secret:${e.secretRef.name ?? ''}` : stableStringify(e);
    c.keyed(ctx, 'envFrom', toMap(b.envFrom, envFromKey), toMap(a.envFrom, envFromKey));
    const portKey = (p: NonNullable<Container['ports']>[number]) => `${p.containerPort}/${p.protocol ?? 'TCP'}`;
    c.keyed(ctx, 'ports', toMap(b.ports, portKey), toMap(a.ports, portKey));
    c.keyed(ctx, 'resources.requests', recordToMap(b.resources?.requests), recordToMap(a.resources?.requests));
    c.keyed(ctx, 'resources.limits', recordToMap(b.resources?.limits), recordToMap(a.resources?.limits));
    c.value(ctx, 'livenessProbe', b.livenessProbe, a.livenessProbe);
    c.value(ctx, 'readinessProbe', b.readinessProbe, a.readinessProbe);
    c.value(ctx, 'startupProbe', b.startupProbe, a.startupProbe);
    c.keyed(ctx, 'volumeMounts', toMap(b.volumeMounts, m => m.mountPath), toMap(a.volumeMounts, m => m.mountPath));
    c.value(ctx, 'securityContext', b.securityContext, a.securityContext);
    c.value(ctx, 'lifecycle', b.lifecycle, a.lifecycle);
    c.value(ctx, 'restartPolicy', b.restartPolicy, a.restartPolicy);
}

function kindOf(list: 'initContainers' | 'containers', c: Container): ContainerKind {
    if (list === 'containers') return 'main';
    return c.restartPolicy === 'Always' ? 'sidecar' : 'init';
}

function diffContainerList(
    c: ChangeCollector, list: 'initContainers' | 'containers',
    before: Container[] | undefined, after: Container[] | undefined,
): void {
    const b = toMap(before, x => x.name);
    const a = toMap(after, x => x.name);
    const names = new Set([...b.keys(), ...a.keys()]);
    for (const name of names) {
        const bc = b.get(name);
        const ac = a.get(name);
        if (bc && ac) {
            diffContainer(c, { scope: 'container', container: name, containerKind: kindOf(list, ac) }, bc, ac);
        } else if (bc) {
            const ctx: Ctx = { scope: 'container', container: name, containerKind: kindOf(list, bc) };
            c.push(ctx, 'removed', 'container', `container ${name} removed`, bc.image ?? null, null);
        } else if (ac) {
            const ctx: Ctx = { scope: 'container', container: name, containerKind: kindOf(list, ac) };
            c.push(ctx, 'added', 'container', `container ${name} added (${ac.image ?? 'no image'})`, null, ac.image ?? null);
        }
    }
}

export function diffPodTemplates(before: PodTemplate | null, after: PodTemplate): TemplateChange[] {
    if (before === null) {
        return [{ kind: 'added', scope: 'pod', container: null, containerKind: null, field: 'template', label: 'Initial revision', before: null, after: null }];
    }
    const c = new ChangeCollector();
    const pod: Ctx = { scope: 'pod', container: null, containerKind: null };

    // Rollout restart first: it's usually the only change and the most informative label.
    const bAnn = before.metadata?.annotations ?? {};
    const aAnn = after.metadata?.annotations ?? {};
    const bRestart = bAnn[RESTARTED_AT];
    const aRestart = aAnn[RESTARTED_AT];
    let skipRestartAnnotation = false;
    if (aRestart && aRestart !== bRestart) {
        c.push(pod, bRestart ? 'changed' : 'added', `annotations.${RESTARTED_AT}`, 'Rollout restart triggered', bRestart ?? null, aRestart);
        skipRestartAnnotation = true;
    }

    diffContainerList(c, 'initContainers', before.spec?.initContainers, after.spec?.initContainers);
    diffContainerList(c, 'containers', before.spec?.containers, after.spec?.containers);

    const bs = before.spec;
    const as = after.spec;
    c.keyed(pod, 'volumes', toMap(bs?.volumes, v => v.name), toMap(as?.volumes, v => v.name));
    c.value(pod, 'serviceAccountName', bs?.serviceAccountName, as?.serviceAccountName);
    c.value(pod, 'nodeSelector', bs?.nodeSelector, as?.nodeSelector);
    c.value(pod, 'affinity', bs?.affinity, as?.affinity);
    c.value(pod, 'tolerations', bs?.tolerations, as?.tolerations);
    c.value(pod, 'topologySpreadConstraints', bs?.topologySpreadConstraints, as?.topologySpreadConstraints);
    c.value(pod, 'priorityClassName', bs?.priorityClassName, as?.priorityClassName);
    c.value(pod, 'securityContext', bs?.securityContext, as?.securityContext);
    c.value(pod, 'hostNetwork', bs?.hostNetwork, as?.hostNetwork);
    c.value(pod, 'hostPID', bs?.hostPID, as?.hostPID);
    c.value(pod, 'hostIPC', bs?.hostIPC, as?.hostIPC);
    c.value(pod, 'imagePullSecrets', bs?.imagePullSecrets, as?.imagePullSecrets);
    c.value(pod, 'terminationGracePeriodSeconds', bs?.terminationGracePeriodSeconds, as?.terminationGracePeriodSeconds);

    c.keyed(pod, 'labels', recordToMap(before.metadata?.labels, [POD_TEMPLATE_HASH]), recordToMap(after.metadata?.labels, [POD_TEMPLATE_HASH]));
    const annSkip = skipRestartAnnotation ? [RESTARTED_AT] : [];
    c.keyed(pod, 'annotations', recordToMap(bAnn, annSkip), recordToMap(aAnn, annSkip));

    return c.changes;
}

export function summarizeChanges(changes: TemplateChange[], max = 3): { lines: string[]; more: number } {
    return { lines: changes.slice(0, max).map(ch => ch.label), more: Math.max(0, changes.length - max) };
}
