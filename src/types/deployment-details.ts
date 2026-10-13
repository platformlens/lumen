/**
 * Cross-process types for the Deployment Full View.
 * Imported by both the main process (electron/) and the renderer (src/).
 */
import type {
    V1Deployment, V1ReplicaSet, V1Service, V1Ingress, V1NetworkPolicy,
    V2HorizontalPodAutoscaler, V1PodDisruptionBudget, V1PodTemplateSpec, V1LabelSelector,
} from '@kubernetes/client-node';

/** client-node deserializes timestamps to Date; main JSON-normalizes so the renderer only sees ISO strings. */
export type Jsonified<T> = T extends Date ? string
    : T extends Array<infer U> ? Jsonified<U>[]
    : T extends object ? { [K in keyof T]: Jsonified<T[K]> } : T;

export type DeploymentObj = Jsonified<V1Deployment>;
export type ReplicaSetObj = Jsonified<V1ReplicaSet>;
export type PodTemplate = Jsonified<V1PodTemplateSpec>;
export type LabelSelector = Jsonified<V1LabelSelector>;

export type SectionResult<T> =
    | { status: 'ok'; data: T; note?: string }   // note: non-fatal caveat rendered as an info line
    | { status: 'forbidden'; message: string }   // 403
    | { status: 'error'; message: string };      // API group 404, timeout, 5xx, network

export interface DeploymentPodContainerStatus {
    name: string; kind: 'init' | 'sidecar' | 'main';
    ready: boolean; started: boolean | null; restartCount: number;
    state: 'running' | 'waiting' | 'terminated' | 'unknown';
    reason: string | null;                  // CrashLoopBackOff, OOMKilled, Completed…
    lastTerminationReason: string | null;
    image: string; imageID: string;         // imageID carries the running digest
}
export interface DeploymentPodSummary {
    name: string; uid: string; namespace: string;
    phase: string;                          // raw status.phase
    displayStatus: string;                  // Terminating | <waiting reason> | <terminated reason> | phase
    readyContainers: number; totalContainers: number;   // main + sidecar only
    restarts: number;                       // sum over all containers
    nodeName: string | null; podIP: string | null; hostIP: string | null;
    createdAt: string; startTime: string | null; deletionTimestamp: string | null;
    qosClass: string | null; podTemplateHash: string | null; ownerReplicaSet: string | null;
    unschedulableMessage: string | null;    // PodScheduled=False message
    containers: DeploymentPodContainerStatus[];
}
export interface NodeSummary {
    name: string; ready: boolean; unschedulable: boolean;
    hostname: string | null;      // label kubernetes.io/hostname (may differ from name)
    zone: string | null;          // topology.kubernetes.io/zone ?? failure-domain.beta.kubernetes.io/zone
    region: string | null;        // topology.kubernetes.io/region
    instanceType: string | null;  // node.kubernetes.io/instance-type ?? beta.kubernetes.io/instance-type
    capacityType: string | null;  // karpenter.sh/capacity-type ?? eks.amazonaws.com/capacityType
    nodePool: string | null;      // karpenter.sh/nodepool ?? eks.amazonaws.com/nodegroup
    arch: string | null; os: string | null; kubeletVersion: string | null;
    taints: { key: string; value: string | null; effect: string }[];
    allocatable: { cpu: string | null; memory: string | null; pods: string | null };
}
export interface DeploymentEvent {
    type: string;                   // 'Normal' | 'Warning' in practice; kept open because the API doesn't constrain it
    reason: string; message: string;
    count: number;                  // always >= 1
    firstTimestamp: string | null;
    lastTimestamp: string;          // always set
    involvedKind: string; involvedName: string; involvedUid: string; source: string | null;
}
export interface ServiceAccountSummary {
    name: string; exists: boolean;
    automountServiceAccountToken: boolean | null;
    imagePullSecretNames: string[];
    irsaRoleArn: string | null;     // annotation eks.amazonaws.com/role-arn
}
export interface NamespaceSummary {
    name: string;
    podSecurity: { enforce: string | null; enforceVersion: string | null; audit: string | null; warn: string | null };
}
export interface PvcSummary {
    claimName: string; found: boolean; phase: string | null; storageClass: string | null;
    capacity: string | null; accessModes: string[]; volumeName: string | null;
}
export interface DeploymentFullDetails {
    context: string; fetchedAt: string;
    deployment: DeploymentObj;                         // managedFields and last-applied-configuration stripped; kind/apiVersion guaranteed
    lastAppliedBytes: number | null;                   // UTF-8 byte length of the stripped last-applied annotation, null if absent
    replicaSets: SectionResult<ReplicaSetObj[]>;       // owned by this deployment (by uid)
    pods: SectionResult<DeploymentPodSummary[]>;
    nodes: SectionResult<NodeSummary[]>;               // only nodes hosting this deployment's pods
    events: SectionResult<DeploymentEvent[]>;          // newest first, max 300
    services: SectionResult<Jsonified<V1Service>[]>;
    ingresses: SectionResult<Jsonified<V1Ingress>[]>;
    networkPolicies: SectionResult<Jsonified<V1NetworkPolicy>[]>;
    hpas: SectionResult<Jsonified<V2HorizontalPodAutoscaler>[]>;
    pdbs: SectionResult<Jsonified<V1PodDisruptionBudget>[]>;
    serviceAccount: SectionResult<ServiceAccountSummary>;
    namespace: SectionResult<NamespaceSummary>;
    pvcs: SectionResult<PvcSummary[]>;
    /** keyed by pod NAME (not ns/name); only pods of this deployment */
    podMetrics: SectionResult<Record<string, { cpu: string; memory: string }>>;
}
export type DeploymentFullDetailsResponse =
    | { found: true; details: DeploymentFullDetails }
    | { found: false; reason: 'not-found' | 'forbidden'; message: string };
