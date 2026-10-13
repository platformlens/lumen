/**
 * Pod distribution across nodes and zones, plus availability risk flags.
 */
import type { DeploymentPodSummary, NodeSummary } from '../types/deployment-details';

export interface NodeGroup {
    nodeName: string; node: NodeSummary | null; zone: string | null;
    pods: DeploymentPodSummary[]; readyPods: number; restarts: number;
    statusCounts: Record<string, number>;          // keyed by displayStatus
}
export interface ZoneGroup { zone: string | null; nodes: NodeGroup[]; podCount: number }
export interface DistributionRisk {
    id: 'single-replica' | 'single-node' | 'single-zone' | 'node-concentration'
    | 'unscheduled' | 'zone-unknown' | 'spread-skew' | 'node-not-ready';
    level: 'info' | 'warn' | 'fail'; message: string;
}

const ZONE_KEY = 'topology.kubernetes.io/zone';
const HOSTNAME_KEY = 'kubernetes.io/hostname';

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isActive = (p: DeploymentPodSummary) => !p.deletionTimestamp;
const isReady = (p: DeploymentPodSummary) => p.totalContainers > 0 && p.readyContainers === p.totalContainers;

/** Groups pods by node; pods without a nodeName are returned as unscheduled. */
export function groupPodsByNode(pods: DeploymentPodSummary[], nodes: NodeSummary[]): { scheduled: NodeGroup[]; unscheduled: DeploymentPodSummary[] } {
    const nodeByName = new Map(nodes.map(n => [n.name, n]));
    const groups = new Map<string, NodeGroup>();
    const unscheduled: DeploymentPodSummary[] = [];
    for (const pod of pods) {
        if (!pod.nodeName) { unscheduled.push(pod); continue; }
        let g = groups.get(pod.nodeName);
        if (!g) {
            const node = nodeByName.get(pod.nodeName) ?? null;
            g = { nodeName: pod.nodeName, node, zone: node?.zone ?? null, pods: [], readyPods: 0, restarts: 0, statusCounts: {} };
            groups.set(pod.nodeName, g);
        }
        g.pods.push(pod);
        if (isReady(pod)) g.readyPods++;
        g.restarts += pod.restarts;
        g.statusCounts[pod.displayStatus] = (g.statusCounts[pod.displayStatus] ?? 0) + 1;
    }
    const scheduled = [...groups.values()].sort((a, b) => b.pods.length - a.pods.length || byName(a.nodeName, b.nodeName));
    return { scheduled, unscheduled };
}

/** Groups node groups by zone; the unknown (null) zone sorts after known zones with the same pod count. */
export function groupNodesByZone(groups: NodeGroup[]): ZoneGroup[] {
    const zones = new Map<string | null, ZoneGroup>();
    for (const g of groups) {
        let z = zones.get(g.zone);
        if (!z) { z = { zone: g.zone, nodes: [], podCount: 0 }; zones.set(g.zone, z); }
        z.nodes.push(g);
        z.podCount += g.pods.length;
    }
    const result = [...zones.values()];
    for (const z of result) z.nodes.sort((a, b) => b.pods.length - a.pods.length || byName(a.nodeName, b.nodeName));
    return result.sort((a, b) => b.podCount - a.podCount
        || (a.zone === null ? 1 : 0) - (b.zone === null ? 1 : 0)
        || byName(a.zone ?? '', b.zone ?? ''));
}

interface TscLike { topologyKey?: unknown; maxSkew?: unknown }

/** Availability risks. Terminating pods (deletionTimestamp set) are excluded from the math. */
export function assessDistributionRisks(input: {
    groups: NodeGroup[]; unscheduled: DeploymentPodSummary[];
    desiredReplicas: number; topologySpreadConstraints: unknown[] | undefined; nodesAvailable: boolean;
}): DistributionRisk[] {
    const risks: DistributionRisk[] = [];
    const active = input.groups
        .map(g => ({ group: g, count: g.pods.filter(isActive).length }))
        .filter(a => a.count > 0);
    const n = active.reduce((sum, a) => sum + a.count, 0);

    if (input.desiredReplicas === 1) {
        risks.push({ id: 'single-replica', level: 'info', message: 'Single replica: any pod disruption causes downtime' });
    }
    if (n >= 2 && active.length === 1) {
        risks.push({ id: 'single-node', level: 'fail', message: `All ${n} pods run on node ${active[0].group.nodeName}` });
    }
    const zones = new Set(active.map(a => a.group.zone));
    if (n >= 2 && !zones.has(null) && zones.size === 1) {
        risks.push({ id: 'single-zone', level: 'warn', message: `All ${n} pods run in zone ${[...zones][0]}` });
    }
    if (n >= 3) {
        const limit = Math.ceil(n / 2);
        const hot = active.filter(a => a.count > limit);
        if (hot.length > 0) {
            risks.push({ id: 'node-concentration', level: 'warn',
                message: `Node ${hot[0].group.nodeName} hosts ${hot[0].count} of ${n} pods` });
        }
    }
    const pending = input.unscheduled.filter(isActive);
    if (pending.length > 0) {
        const msg = pending.find(p => p.unschedulableMessage)?.unschedulableMessage;
        risks.push({ id: 'unscheduled', level: 'warn',
            message: `${pending.length} pod${pending.length === 1 ? '' : 's'} not scheduled${msg ? `: ${msg}` : ''}` });
    }
    if (!input.nodesAvailable) {
        risks.push({ id: 'zone-unknown', level: 'info', message: 'Node details unavailable; zones are unknown' });
    } else if (active.some(a => a.group.zone === null)) {
        risks.push({ id: 'zone-unknown', level: 'info', message: 'Some nodes have no zone label' });
    }
    for (const raw of input.topologySpreadConstraints ?? []) {
        const tsc = (raw ?? {}) as TscLike;
        const key = tsc.topologyKey;
        const maxSkew = typeof tsc.maxSkew === 'number' ? tsc.maxSkew : 1;
        if (key !== ZONE_KEY && key !== HOSTNAME_KEY) continue;
        const perDomain = new Map<string, number>();
        for (const a of active) {
            const domain = key === ZONE_KEY ? a.group.zone : (a.group.node?.hostname ?? a.group.nodeName);
            if (domain === null) continue;
            perDomain.set(domain, (perDomain.get(domain) ?? 0) + a.count);
        }
        if (perDomain.size === 0) continue;
        const counts = [...perDomain.values()];
        const skew = Math.max(...counts) - Math.min(...counts);
        if (skew > maxSkew) {
            risks.push({ id: 'spread-skew', level: 'warn',
                message: `Spread on ${key} is skewed by ${skew} (maxSkew ${maxSkew}); empty eligible domains aren't visible` });
        }
    }
    const badNodes = active
        .filter(a => a.group.node && (!a.group.node.ready || a.group.node.unschedulable))
        .map(a => `${a.group.nodeName} (${a.group.node?.ready ? 'cordoned' : 'NotReady'})`);
    if (badNodes.length > 0) {
        risks.push({ id: 'node-not-ready', level: 'warn', message: `Pods run on unhealthy nodes: ${badNodes.join(', ')}` });
    }
    return risks;
}
