/**
 * Derived (memoized) data for the Deployment Full View. Every value is computed once per `details` change.
 * The container (DeploymentFullView) is the only caller; sections receive the results as props.
 */
import { useCallback, useMemo } from 'react';
import type {
    DeploymentEvent, DeploymentFullDetails, DeploymentPodSummary, PodTemplate, SectionResult,
} from '../../../../types/deployment-details';
import {
    buildRevisionByHash, buildRevisionTimeline, eventsForRevision, getPreviousRevision, type RevisionEntry,
} from '../../../../utils/deployment-history-utils';
import {
    getRolloutSummary, summarizeHpa, summarizePdb, type HpaSummary, type PdbSummary, type RolloutSummary,
} from '../../../../utils/deployment-rollout-utils';
import { diffPodTemplates, summarizeChanges } from '../../../../utils/pod-template-diff-utils';
import { firstMainContainerName, toLogTarget, type LogTarget } from '../../../../utils/deployment-log-utils';
import {
    assessDistributionRisks, groupNodesByZone, groupPodsByNode, type DistributionRisk, type ZoneGroup,
} from '../../../../utils/pod-distribution-utils';
import { buildContainerInsights, type ContainerInsight } from '../../../../utils/container-insights-utils';
import { evaluateSecurityPosture, type SecurityPostureReport } from '../../../../utils/security-posture-utils';
import {
    describeNetworkPolicy, ingressRoutesForServices, mapServicePorts, type IngressRoute, type PortMapping,
} from '../../../../utils/networking-utils';
import { revisionKey, type RevisionMeta } from './revision-format';
import { collectConfigRefs, type ConfigRefs } from './config-refs';

export interface DistributionData {
    zones: ZoneGroup[];
    unscheduled: DeploymentPodSummary[];
    risks: DistributionRisk[];
    totalPods: number;
}
export interface ServiceRow {
    name: string; type: string; clusterIP: string | null;
    /** status.loadBalancer.ingress hostnames / IPs */
    loadBalancer: string[];
    ports: PortMapping[];
}
export type NetworkPolicyRow = ReturnType<typeof describeNetworkPolicy>;

export interface DeploymentDerivedData {
    template: PodTemplate;
    rollout: RolloutSummary;
    revisions: RevisionEntry[];
    revisionByHash: Map<string, RevisionEntry>;
    /** eventsForRevision per entry, keyed by revisionKey. */
    revisionEvents: Map<string, DeploymentEvent[]>;
    /** Hover-card summary (vs previous) + warning count per entry, keyed by revisionKey. */
    revisionMeta: Map<string, RevisionMeta>;
    hpas: SectionResult<HpaSummary[]>;
    pdbs: SectionResult<PdbSummary[]>;
    /** First HPA of an ok `hpas` result (main already filtered to HPAs targeting this deployment). */
    targetingHpa: HpaSummary | null;
    distribution: DistributionData;
    containers: ContainerInsight[];
    security: SecurityPostureReport;
    services: SectionResult<ServiceRow[]>;
    ingressRoutes: SectionResult<IngressRoute[]>;
    networkPolicies: SectionResult<NetworkPolicyRow[]>;
    configRefs: ConfigRefs;
}

/** Maps an ok SectionResult's data, passing forbidden/error through unchanged. */
export function mapSectionResult<T, U>(r: SectionResult<T>, fn: (data: T) => U): SectionResult<U> {
    return r.status === 'ok' ? { status: 'ok', data: fn(r.data), note: r.note } : r;
}

const EMPTY_TEMPLATE: PodTemplate = {};

export function useDeploymentDerivedData(details: DeploymentFullDetails | null): DeploymentDerivedData | null {
    return useMemo(() => {
        if (!details) return null;
        const { deployment } = details;
        const pods = details.pods.status === 'ok' ? details.pods.data : null;
        const replicaSets = details.replicaSets.status === 'ok' ? details.replicaSets.data : [];
        const events = details.events.status === 'ok' ? details.events.data : [];

        const revisions = buildRevisionTimeline(deployment, replicaSets, pods);
        const revisionEvents = new Map<string, DeploymentEvent[]>();
        const revisionMeta = new Map<string, RevisionMeta>();
        for (const entry of revisions) {
            const key = revisionKey(entry);
            const evs = eventsForRevision(events, entry);
            revisionEvents.set(key, evs);
            const prev = getPreviousRevision(revisions, entry);
            revisionMeta.set(key, {
                summary: summarizeChanges(diffPodTemplates(prev?.template ?? null, entry.template)),
                warningCount: evs.reduce((n, ev) => (ev.type === 'Warning' ? n + 1 : n), 0),
            });
        }

        const hpas = mapSectionResult(details.hpas, list => list.map(summarizeHpa));
        const pdbs = mapSectionResult(details.pdbs, list => list.map(summarizePdb));

        const template = deployment.spec?.template ?? EMPTY_TEMPLATE;
        const nodes = details.nodes.status === 'ok' ? details.nodes.data : [];
        const { scheduled, unscheduled } = groupPodsByNode(pods ?? [], nodes);
        const distribution: DistributionData = {
            zones: groupNodesByZone(scheduled),
            unscheduled,
            risks: pods ? assessDistributionRisks({
                groups: scheduled, unscheduled,
                desiredReplicas: deployment.spec?.replicas ?? 1,
                topologySpreadConstraints: template.spec?.topologySpreadConstraints,
                nodesAvailable: details.nodes.status === 'ok',
            }) : [],
            totalPods: pods?.length ?? 0,
        };

        const serviceAccount = details.serviceAccount.status === 'ok' ? details.serviceAccount.data : null;
        const services = mapSectionResult(details.services, list => list.map((svc): ServiceRow => ({
            name: svc.metadata?.name ?? '',
            type: svc.spec?.type ?? 'ClusterIP',
            clusterIP: svc.spec?.clusterIP ?? null,
            loadBalancer: (svc.status?.loadBalancer?.ingress ?? []).map(i => i.hostname ?? i.ip ?? '').filter(Boolean),
            ports: mapServicePorts([svc], template),
        })));
        const serviceNames = new Set(details.services.status === 'ok' ? details.services.data.map(s => s.metadata?.name ?? '') : []);
        const ingressRoutes: SectionResult<IngressRoute[]> = details.ingresses.status !== 'ok'
            ? details.ingresses
            : details.services.status !== 'ok'
                ? { status: 'ok', data: [], note: 'Services unavailable; ingress routes to this deployment can’t be resolved' }
                : { status: 'ok', data: ingressRoutesForServices(details.ingresses.data, serviceNames), note: details.ingresses.note };

        return {
            template,
            rollout: getRolloutSummary(deployment),
            revisions,
            revisionByHash: buildRevisionByHash(revisions),
            revisionEvents,
            revisionMeta,
            hpas,
            pdbs,
            targetingHpa: hpas.status === 'ok' ? hpas.data[0] ?? null : null,
            distribution,
            containers: buildContainerInsights(template, pods),
            security: evaluateSecurityPosture(template, { serviceAccount }),
            services,
            ingressRoutes,
            networkPolicies: mapSectionResult(details.networkPolicies, list => list.map(describeNetworkPolicy)),
            configRefs: collectConfigRefs(template, serviceAccount),
        };
    }, [details]);
}

/**
 * Logs action for pod rows / pod dots (§6.1 "Logs"). Returns undefined when logs can't be opened at all;
 * `canOpen(pod)` is false when no main container name can be resolved (hide the button then).
 */
export function usePodLogsHandler(
    onOpenLogs: ((pod: LogTarget, containerName: string) => void) | undefined,
    template: PodTemplate,
): { onOpenPodLogs: ((pod: DeploymentPodSummary) => void) | undefined; canOpen: (pod: DeploymentPodSummary) => boolean } {
    const handleOpenPodLogs = useCallback(
        (pod: DeploymentPodSummary) => onOpenLogs?.(toLogTarget(pod, template), firstMainContainerName(pod, template)),
        [onOpenLogs, template]);
    const canOpen = useCallback(
        (pod: DeploymentPodSummary) => onOpenLogs !== undefined && firstMainContainerName(pod, template) !== '',
        [onOpenLogs, template]);
    return useMemo(
        () => ({ onOpenPodLogs: onOpenLogs ? handleOpenPodLogs : undefined, canOpen }),
        [onOpenLogs, handleOpenPodLogs, canOpen]);
}
