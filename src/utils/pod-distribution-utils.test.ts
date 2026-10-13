import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { groupPodsByNode, groupNodesByZone, assessDistributionRisks, type DistributionRisk } from './pod-distribution-utils';
import type { DeploymentPodSummary, NodeSummary } from '../types/deployment-details';

const pod = (name: string, nodeName: string | null, extra: Partial<DeploymentPodSummary> = {}): DeploymentPodSummary => ({
    name, uid: `uid-${name}`, namespace: 'default', phase: 'Running', displayStatus: 'Running',
    readyContainers: 1, totalContainers: 1, restarts: 0, nodeName, podIP: null, hostIP: null,
    createdAt: '2024-01-01T00:00:00Z', startTime: null, deletionTimestamp: null, qosClass: null,
    podTemplateHash: null, ownerReplicaSet: null, unschedulableMessage: null, containers: [], ...extra,
});
const node = (name: string, zone: string | null, extra: Partial<NodeSummary> = {}): NodeSummary => ({
    name, ready: true, unschedulable: false, hostname: name, zone, region: null, instanceType: null,
    capacityType: null, nodePool: null, arch: null, os: null, kubeletVersion: null, taints: [],
    allocatable: { cpu: null, memory: null, pods: null }, ...extra,
});
const risks = (pods: DeploymentPodSummary[], nodes: NodeSummary[], opts: { desired?: number; tsc?: unknown[]; nodesAvailable?: boolean } = {}) => {
    const { scheduled, unscheduled } = groupPodsByNode(pods, nodes);
    return assessDistributionRisks({ groups: scheduled, unscheduled, desiredReplicas: opts.desired ?? pods.length,
        topologySpreadConstraints: opts.tsc, nodesAvailable: opts.nodesAvailable ?? true });
};
const ids = (r: DistributionRisk[]) => r.map(x => x.id);

describe('groupPodsByNode', () => {
    it('grouped + unscheduled == input count (property)', () => {
        fc.assert(fc.property(fc.array(fc.option(fc.constantFrom('n1', 'n2', 'n3'), { nil: null })), names => {
            const pods = names.map((n, i) => pod(`p${i}`, n));
            const { scheduled, unscheduled } = groupPodsByNode(pods, [node('n1', 'a')]);
            return scheduled.reduce((s, g) => s + g.pods.length, 0) + unscheduled.length === pods.length;
        }));
    });
    it('aggregates per node and sorts by pod count, then name', () => {
        const { scheduled } = groupPodsByNode([
            pod('a', 'n2'), pod('b', 'n1', { restarts: 2, displayStatus: 'CrashLoopBackOff', readyContainers: 0 }),
            pod('c', 'n1'), pod('d', 'n3'),
        ], [node('n1', 'z1')]);
        expect(scheduled.map(g => g.nodeName)).toEqual(['n1', 'n2', 'n3']);
        expect(scheduled[0]).toMatchObject({ readyPods: 1, restarts: 2, zone: 'z1', statusCounts: { Running: 1, CrashLoopBackOff: 1 } });
    });
    it('missing node summaries give an unknown zone', () => {
        const { scheduled } = groupPodsByNode([pod('a', 'ghost')], []);
        expect(scheduled[0]).toMatchObject({ node: null, zone: null });
    });
});

describe('groupNodesByZone', () => {
    it('groups by zone, sorted by pod count with unknown last', () => {
        const { scheduled } = groupPodsByNode([pod('a', 'n1'), pod('b', 'n2'), pod('c', 'n2'), pod('d', 'n3'), pod('e', 'x')],
            [node('n1', 'a'), node('n2', 'b'), node('n3', 'a')]);
        const zones = groupNodesByZone(scheduled);
        expect(zones.map(z => [z.zone, z.podCount])).toEqual([['a', 2], ['b', 2], [null, 1]]);
        expect(zones[0].nodes.map(n => n.nodeName)).toEqual(['n1', 'n3']);
    });
});

describe('assessDistributionRisks', () => {
    const nodes = [node('n1', 'a'), node('n2', 'b'), node('n3', 'c')];
    it('single-replica', () => {
        expect(ids(risks([pod('a', 'n1')], nodes, { desired: 1 }))).toEqual(['single-replica']);
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n2')], nodes))).not.toContain('single-replica');
    });
    it('single-node', () => {
        const r = risks([pod('a', 'n1'), pod('b', 'n1')], nodes);
        expect(r.find(x => x.id === 'single-node')?.level).toBe('fail');
        expect(ids(risks([pod('a', 'n1')], nodes, { desired: 1 }))).not.toContain('single-node');
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n2')], nodes))).not.toContain('single-node');
    });
    it('single-zone only when every zone is known', () => {
        const zoneNodes = [node('n1', 'a'), node('n2', 'a'), node('n3', null)];
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n2')], zoneNodes))).toContain('single-zone');
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n3')], zoneNodes))).not.toContain('single-zone');
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n2')], nodes))).not.toContain('single-zone');
    });
    it('node-concentration when a node hosts more than ceil(n/2)', () => {
        const pods = [pod('a', 'n1'), pod('b', 'n1'), pod('c', 'n1'), pod('d', 'n2')];
        expect(ids(risks(pods, nodes))).toContain('node-concentration');
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n1'), pod('c', 'n2')], nodes))).not.toContain('node-concentration');
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n1')], nodes))).not.toContain('node-concentration');
    });
    it('unscheduled includes the first scheduler message', () => {
        const r = risks([pod('a', 'n1'), pod('b', null, { unschedulableMessage: '0/3 nodes are available' })], nodes);
        expect(r.find(x => x.id === 'unscheduled')?.message).toContain('0/3 nodes are available');
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n2')], nodes))).not.toContain('unscheduled');
    });
    it('zone-unknown when nodes are unavailable or zones missing', () => {
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n2')], [], { nodesAvailable: false }))).toContain('zone-unknown');
        expect(ids(risks([pod('a', 'n1'), pod('b', 'ghost')], nodes))).toContain('zone-unknown');
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n2')], nodes))).not.toContain('zone-unknown');
    });
    it('spread-skew on zone', () => {
        const tsc = [{ topologyKey: 'topology.kubernetes.io/zone', maxSkew: 1 }];
        const pods = [pod('a', 'n1'), pod('b', 'n1'), pod('c', 'n1'), pod('d', 'n2')];
        const r = risks(pods, nodes, { tsc });
        expect(r.find(x => x.id === 'spread-skew')?.message).toContain("empty eligible domains aren't visible");
        expect(ids(risks([pod('a', 'n1'), pod('b', 'n2')], nodes, { tsc }))).not.toContain('spread-skew');
        expect(ids(risks(pods, nodes, { tsc: [{ topologyKey: 'topology.kubernetes.io/zone', maxSkew: 2 }] }))).not.toContain('spread-skew');
        expect(ids(risks(pods, nodes, { tsc: [{ topologyKey: 'custom/rack', maxSkew: 1 }] }))).not.toContain('spread-skew');
    });
    it('hostname TSC uses node.hostname, falling back to nodeName', () => {
        const tsc = [{ topologyKey: 'kubernetes.io/hostname', maxSkew: 1 }];
        // n1 and n2 share the same hostname label: one domain -> no skew (by nodeName it would be 3 vs 1).
        const shared = [node('n1', 'a', { hostname: 'h' }), node('n2', 'a', { hostname: 'h' })];
        const pods = [pod('a', 'n1'), pod('b', 'n1'), pod('c', 'n2')];
        expect(ids(risks([...pods, pod('d', 'n1')], shared, { tsc }))).not.toContain('spread-skew');
        // No summaries: domains are node names n1 (2) and n2 (1) -> skew 1, still within maxSkew; add a pod to skew 2.
        expect(ids(risks(pods, [], { tsc }))).not.toContain('spread-skew');
        expect(ids(risks([...pods, pod('d', 'n1')], [], { tsc }))).toContain('spread-skew');
    });
    it('node-not-ready for NotReady or cordoned hosting nodes', () => {
        const bad = [node('n1', 'a', { ready: false }), node('n2', 'b', { unschedulable: true }), node('n3', 'c')];
        const msg = risks([pod('a', 'n1'), pod('b', 'n2')], bad).find(x => x.id === 'node-not-ready')?.message;
        expect(msg).toContain('n1 (NotReady)');
        expect(msg).toContain('n2 (cordoned)');
        expect(ids(risks([pod('a', 'n3'), pod('b', 'n2', { deletionTimestamp: '2024' })], bad))).not.toContain('node-not-ready');
    });
    it('excludes terminating pods from risk math', () => {
        const r = risks([pod('a', 'n1'), pod('b', 'n2', { deletionTimestamp: '2024-01-01T00:00:00Z' })], nodes, { desired: 2 });
        expect(ids(r)).toEqual([]);
        const r2 = risks([pod('a', 'n1'), pod('b', 'n1', { deletionTimestamp: '2024-01-01T00:00:00Z' })], nodes, { desired: 2 });
        expect(ids(r2)).not.toContain('single-node');
        expect(ids(risks([pod('a', 'n1'), pod('b', null, { deletionTimestamp: '2024' })], nodes))).not.toContain('unscheduled');
    });
});
