/**
 * Revision timeline helpers: turns a deployment's ReplicaSets into ordered revision entries,
 * correlates events, and renders revision YAML for the Monaco diff.
 */
import * as jsYaml from 'js-yaml';
import type {
    DeploymentEvent, DeploymentObj, DeploymentPodSummary, LabelSelector, PodTemplate, ReplicaSetObj,
} from '../types/deployment-details';
import { maskTemplateEnv } from './sensitive-value-utils';

export interface RevisionEntry {
    revision: number | null; revisionLabel: string;          // "7" or "?"
    previousRevisions: number[];                              // deployment.kubernetes.io/revision-history (rollbacks)
    replicaSetName: string; replicaSetUid: string; podTemplateHash: string | null;
    createdAt: string; changeCause: string | null;            // kubernetes.io/change-cause
    images: { container: string; image: string; kind: 'init' | 'sidecar' | 'main' }[];
    desiredReplicas: number; currentReplicas: number; readyReplicas: number; availableReplicas: number;
    isCurrent: boolean; isActive: boolean;                    // isActive: currentReplicas > 0
    selector: LabelSelector | null;                           // rs.spec.selector
    template: PodTemplate;                                    // pod-template-hash label removed
}

export interface RevisionYamlInput {
    revision: string; name: string; createdAt: string | Date;
    replicas?: number; selector?: unknown; template: PodTemplate | undefined;
}

const REVISION_ANNOTATION = 'deployment.kubernetes.io/revision';
const REVISION_HISTORY_ANNOTATION = 'deployment.kubernetes.io/revision-history';
const CHANGE_CAUSE_ANNOTATION = 'kubernetes.io/change-cause';
const POD_TEMPLATE_HASH = 'pod-template-hash';

function parseRevision(v: string | undefined): number | null {
    if (v === undefined || !/^\d+$/.test(v.trim())) return null;
    return parseInt(v.trim(), 10);
}

function parseRevisionHistory(v: string | undefined): number[] {
    if (!v) return [];
    return v.split(',').map(s => parseRevision(s)).filter((n): n is number => n !== null);
}

function stripHashLabel(template: PodTemplate | undefined): PodTemplate {
    if (!template) return {};
    const labels = template.metadata?.labels;
    if (!labels || !(POD_TEMPLATE_HASH in labels)) return template;
    const rest = { ...labels };
    delete rest[POD_TEMPLATE_HASH];
    return { ...template, metadata: { ...template.metadata, labels: rest } };
}

function imagesOf(template: PodTemplate | undefined): RevisionEntry['images'] {
    const out: RevisionEntry['images'] = [];
    for (const c of template?.spec?.initContainers ?? []) {
        out.push({ container: c.name, image: c.image ?? '', kind: c.restartPolicy === 'Always' ? 'sidecar' : 'init' });
    }
    for (const c of template?.spec?.containers ?? []) {
        out.push({ container: c.name, image: c.image ?? '', kind: 'main' });
    }
    return out;
}

function toEntry(rs: ReplicaSetObj): RevisionEntry {
    const ann = rs.metadata?.annotations ?? {};
    const revision = parseRevision(ann[REVISION_ANNOTATION]);
    const currentReplicas = rs.status?.replicas ?? 0;
    return {
        revision,
        revisionLabel: revision === null ? '?' : String(revision),
        previousRevisions: parseRevisionHistory(ann[REVISION_HISTORY_ANNOTATION]),
        replicaSetName: rs.metadata?.name ?? '',
        replicaSetUid: rs.metadata?.uid ?? '',
        podTemplateHash: rs.metadata?.labels?.[POD_TEMPLATE_HASH]
            ?? rs.spec?.template?.metadata?.labels?.[POD_TEMPLATE_HASH] ?? null,
        createdAt: rs.metadata?.creationTimestamp ?? '',
        changeCause: ann[CHANGE_CAUSE_ANNOTATION] ?? null,
        images: imagesOf(rs.spec?.template),
        desiredReplicas: rs.spec?.replicas ?? 0,
        currentReplicas,
        readyReplicas: rs.status?.readyReplicas ?? 0,
        availableReplicas: rs.status?.availableReplicas ?? 0,
        isCurrent: false,
        isActive: currentReplicas > 0,
        selector: rs.spec?.selector ?? null,
        template: stripHashLabel(rs.spec?.template),
    };
}

function compareEntries(a: RevisionEntry, b: RevisionEntry): number {
    if (a.revision !== null && b.revision !== null) return a.revision - b.revision;
    if (a.revision !== null) return -1;
    if (b.revision !== null) return 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

function mostCommonHash(pods: DeploymentPodSummary[] | null | undefined): string | null {
    const counts = new Map<string, number>();
    for (const p of pods ?? []) {
        if (p.podTemplateHash) counts.set(p.podTemplateHash, (counts.get(p.podTemplateHash) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [hash, count] of counts) {
        if (count > bestCount) { best = hash; bestCount = count; }
    }
    return best;
}

/** Ascending by revision (null revisions last, by createdAt); exactly one entry is current when non-empty. */
export function buildRevisionTimeline(
    deployment: DeploymentObj, replicaSets: ReplicaSetObj[], pods?: DeploymentPodSummary[] | null,
): RevisionEntry[] {
    const entries = replicaSets.map(toEntry).sort(compareEntries);
    if (entries.length === 0) return entries;

    const annotated = parseRevision(deployment.metadata?.annotations?.[REVISION_ANNOTATION]);
    let current: RevisionEntry | undefined;
    if (annotated !== null) current = entries.find(e => e.revision === annotated);
    if (!current) {
        const hash = mostCommonHash(pods);
        if (hash) current = entries.find(e => e.podTemplateHash === hash);
    }
    if (!current) {
        const withRevision = entries.filter(e => e.revision !== null);
        current = withRevision.length > 0 ? withRevision[withRevision.length - 1] : entries[entries.length - 1];
    }
    current.isCurrent = true;
    return entries;
}

export function getCurrentRevision(entries: RevisionEntry[]): RevisionEntry | null {
    return entries.find(e => e.isCurrent) ?? null;
}

/** The entry with the greatest revision below `entry.revision`; null for the oldest or an unnumbered entry. */
export function getPreviousRevision(entries: RevisionEntry[], entry: RevisionEntry): RevisionEntry | null {
    if (entry.revision === null) return null;
    let best: RevisionEntry | null = null;
    for (const e of entries) {
        if (e.revision === null || e.revision >= entry.revision) continue;
        if (!best || (best.revision !== null && e.revision > best.revision)) best = e;
    }
    return best;
}

export function buildRevisionByHash(entries: RevisionEntry[]): Map<string, RevisionEntry> {
    const m = new Map<string, RevisionEntry>();
    for (const e of entries) if (e.podTemplateHash) m.set(e.podTemplateHash, e);
    return m;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Union of RS-uid events and Deployment events naming the RS as a whole token; deduplicated, newest first. */
export function eventsForRevision(events: DeploymentEvent[], entry: RevisionEntry): DeploymentEvent[] {
    const re = entry.replicaSetName
        ? new RegExp(`(^|[\\s"'(])${escapeRegExp(entry.replicaSetName)}($|[\\s"',.:)])`)
        : null;
    const matched = new Set<DeploymentEvent>();
    for (const ev of events) {
        if (entry.replicaSetUid && ev.involvedUid === entry.replicaSetUid) matched.add(ev);
        else if (re && ev.involvedKind === 'Deployment' && re.test(ev.message)) matched.add(ev);
    }
    return [...matched].sort((a, b) => (a.lastTimestamp < b.lastTimestamp ? 1 : a.lastTimestamp > b.lastTimestamp ? -1 : 0));
}

/**
 * Revision YAML for diffing. Key order and js-yaml options match the original RevisionDiffModal helper,
 * so drawer diffs are byte-identical apart from masked sensitive env literals.
 */
export function revisionToYaml(input: RevisionYamlInput): string {
    const template = input.template ? maskTemplateEnv(input.template) : undefined;
    const clean = {
        revision: input.revision,
        name: input.name,
        createdAt: input.createdAt,
        replicas: input.replicas,
        template: {
            labels: template?.metadata?.labels,
            annotations: template?.metadata?.annotations,
            spec: template?.spec,
        },
        selector: input.selector,
    };
    // skipInvalid drops undefined values for cleaner YAML
    return jsYaml.dump(clean, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        skipInvalid: true,
        sortKeys: false,
    });
}

export function revisionEntryToYamlInput(e: RevisionEntry): RevisionYamlInput {
    return {
        revision: e.revisionLabel,
        name: e.replicaSetName,
        createdAt: e.createdAt,
        replicas: e.desiredReplicas,
        selector: e.selector ?? undefined,
        template: e.template,
    };
}
