/**
 * Cross-process types for the Crossplane view.
 * Imported by the main process (electron/crossplane-*), the preload typings and the renderer.
 * Every count field used as a table column is a `number` (default 0), never a string.
 */

export type CrossplaneHealth = 'unhealthy' | 'progressing' | 'paused' | 'unknown' | 'healthy' | 'none';
export type ConditionStatus = 'True' | 'False' | 'Unknown';

export const CROSSPLANE_CATEGORIES = ['provider', 'function', 'configuration', 'packageRevision', 'providerConfig',
    'runtimeConfig', 'activationPolicy', 'xrd', 'composition', 'compositionRevision', 'environmentConfig',
    'composite', 'claim', 'usage', 'operation', 'managed'] as const;
export type CrossplaneCategory = typeof CROSSPLANE_CATEGORIES[number];

export const HEALTH_ORDER: Record<CrossplaneHealth, number> = {
    unhealthy: 0, progressing: 1, paused: 2, unknown: 3, healthy: 4, none: 5,
};

// ── IPC ref validation constants (B.8). Shared by electron/crossplane-ipc-schemas.ts and isValidCrossplaneRef. ──
export const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
export const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
/** 'v1' or 'group/version' */
export const API_VERSION = /^([a-z0-9]([-a-z0-9.]*[a-z0-9])?\/)?v[0-9]+((alpha|beta)[0-9]+)?$/;
export const KIND = /^[A-Z][A-Za-z0-9]*$/;
/** group/version/plural */
export const KIND_KEY = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?\/v[0-9]+((alpha|beta)[0-9]+)?\/[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
export const REF_LIMITS = {
    context: 253, apiVersion: 253, kind: 63, name: 253, namespace: 63, kindKey: 320, kindKeys: 50,
} as const;

/** Core Crossplane groups. Unknown kinds in these groups classify as `null`, never `managed`. */
export const CROSSPLANE_CORE_GROUPS = [
    'apiextensions.crossplane.io', 'pkg.crossplane.io', 'protection.crossplane.io', 'ops.crossplane.io',
] as const;

/**
 * Core kinds resolved at detection time. `LegacyUsage` is the apiextensions.crossplane.io Usage;
 * `Usage` is protection.crossplane.io.
 */
export type CrossplaneCoreKind =
    | 'Provider' | 'Function' | 'Configuration'
    | 'ProviderRevision' | 'FunctionRevision' | 'ConfigurationRevision'
    | 'DeploymentRuntimeConfig'
    | 'CompositeResourceDefinition' | 'Composition' | 'CompositionRevision' | 'EnvironmentConfig'
    | 'ManagedResourceDefinition' | 'ManagedResourceActivationPolicy'
    | 'LegacyUsage' | 'Usage' | 'ClusterUsage'
    | 'Operation' | 'CronOperation' | 'WatchOperation';

export interface CrossplaneCondition {
    type: string; status: ConditionStatus; reason?: string; message?: string; lastTransitionTime?: string;
}

export interface CrossplaneObjectRef {
    apiVersion: string; kind: string; name: string; namespace?: string; category?: CrossplaneCategory;
}

export interface CrossplaneRowBase extends CrossplaneObjectRef {
    key: string;            // `${apiVersion}|${kind}|${namespace ?? ''}|${name}`
    uid: string;
    category: CrossplaneCategory;
    age: string;            // creationTimestamp, named `age` for useResourceSorting
    health: CrossplaneHealth;
    healthOrder: number;
    healthReason?: string;
    healthMessage?: string;
    healthSince?: string;
    synced?: ConditionStatus;
    ready?: ConditionStatus;
}

export type NeedsAttentionRow = CrossplaneRowBase;

export interface RevisionRow extends CrossplaneRowBase {
    packageName: string; revision: number; desiredState: 'Active' | 'Inactive'; image: string;
    objectRefCount: number;
}

export interface PackageRow extends CrossplaneRowBase {
    packageRef: string;
    installed?: ConditionStatus;
    healthy?: ConditionStatus;
    currentRevision?: string;
    revisionHealth?: CrossplaneHealth;
    revisionHealthOrder: number;
    revisions: RevisionRow[];
    runtimeConfigName?: string;
    installedDefinitionCount: number;     // 0 when unknown; numeric for sorting
    usedByCompositions: string[];
    usedByCount: number;
    depsFound: number;
    depsInstalled: number;
}

export type XrdScope = 'Namespaced' | 'Cluster' | 'LegacyCluster';

export interface XrdVersionInfo { name: string; served: boolean; referenceable: boolean; }

export interface XrdRow extends CrossplaneRowBase {
    group: string; xrKind: string; xrPlural: string; version: string;
    /** Unknown scope strings are kept for display and treated as Cluster for namespace logic. */
    scope: XrdScope | (string & Record<never, never>);
    claimKind?: string; claimPlural?: string;
    established?: ConditionStatus; offered?: ConditionStatus;
    defaultComposition?: string; enforcedComposition?: string;
    versions: XrdVersionInfo[];
}

export interface CompositionStep { step: string; functionName?: string; }

export interface CompositionRow extends CrossplaneRowBase {
    compositeApiVersion: string; compositeKind: string; mode: 'Pipeline' | 'Resources';
    steps: CompositionStep[]; stepCount: number; revisionCount: number; latestRevision?: number;
}

export interface CompositionRevisionRow extends CrossplaneRowBase {
    compositionName: string; revision: number;
}

export interface CompositeRow extends CrossplaneRowBase {
    scope: XrdRow['scope'];
    compositionName?: string;
    compositionRevisionName?: string;
    resourceRefCount: number;
    /** Set when the claim's apiVersion/kind is known (v1 claimRef, or labels plus XRD claimNames). */
    claim?: CrossplaneObjectRef;
    claimName?: string;
    claimNamespace?: string;
}

export interface ClaimRow extends CrossplaneRowBase {
    compositeRef?: CrossplaneObjectRef; connectionSecretName?: string; compositionName?: string;
}

export interface OperationRow extends CrossplaneRowBase {
    opKind: 'Operation' | 'CronOperation' | 'WatchOperation';
    mode?: string; stepCount: number; succeeded?: ConditionStatus;                   // Operation
    schedule?: string; scheduling?: ConditionStatus; runningCount: number;           // CronOperation
    watchedApiVersion?: string; watchedKind?: string; watchingResources: number; watching?: ConditionStatus; // WatchOperation
    lastScheduleTime?: string; lastSuccessfulTime?: string;
}

export interface ManagedRow extends CrossplaneRowBase {
    kindKey: string; providerName?: string; externalName?: string;
    providerConfigName?: string; providerConfigKind?: string;
    managementPolicies?: string[]; deletionPolicy?: string;
    compositeName?: string; claim?: string;
}

export interface ProviderConfigRow extends CrossplaneRowBase {
    providerName?: string; credentialsSource?: string; userCount: number;
}

export interface RuntimeConfigRow extends CrossplaneRowBase {
    usedBy: CrossplaneObjectRef[]; usedByCount: number;
}

export interface ActivationPolicyRow extends CrossplaneRowBase {
    patterns: string[]; activatedCount: number;
}

export interface EnvironmentConfigRow extends CrossplaneRowBase {
    keys: string[]; keyCount: number;
}

export interface UsageRow extends CrossplaneRowBase {
    of?: string; by?: string; reason?: string; replayDeletion?: boolean;
}

export interface CrossplaneSectionError { section: string; status: number; message: string; }

export type HealthCounts = Record<CrossplaneHealth, number> & { total: number };

// ── Detection ──

export interface CrossplaneFeatures {
    namespacedXrs: boolean; mrds: boolean; protectionUsages: boolean; legacyUsages: boolean;
    environmentConfigs: boolean; deploymentRuntimeConfigs: boolean; operations: boolean;
}

export interface CrossplaneDetection {
    installed: boolean;
    /** null when the core Deployment lookup was forbidden. */
    coreRunning: boolean | null;
    version: string | null;
    majorVersion: number | null;
    /** Values are full apiVersions (`group/version`). Absent when the kind is not served. */
    kindVersions: Partial<Record<CrossplaneCoreKind, string>>;
    features: CrossplaneFeatures;
    fetchedAt: string;
}

// ── Payloads ──

export interface CrossplanePayloadBase { errors: CrossplaneSectionError[]; fetchedAt: string; }
export interface CrossplaneSnapshotBase extends CrossplanePayloadBase { truncatedKinds: string[]; skippedMalformed: number; }

export interface CrossplanePackagesPayload extends CrossplaneSnapshotBase {
    providers: PackageRow[]; functions: PackageRow[]; configurations: PackageRow[];
    revisions: RevisionRow[];
    providerConfigs: ProviderConfigRow[];
    runtimeConfigs: RuntimeConfigRow[];
    activationPolicies: ActivationPolicyRow[];
    providerApiGroups: string[];
}

export interface CrossplaneDefinitionsPayload extends CrossplaneSnapshotBase {
    xrds: XrdRow[]; compositions: CompositionRow[]; compositionRevisions: CompositionRevisionRow[];
    environmentConfigs: EnvironmentConfigRow[];
    claimsSupported: boolean;
}

export interface CrossplaneCompositesPayload extends CrossplaneSnapshotBase {
    composites: CompositeRow[]; claims: ClaimRow[]; usages: UsageRow[];
    /** Empty when ops.crossplane.io isn't served. */
    operations: OperationRow[];
}

/** Parsed `<plural>.<group>` from a revision objectRef or CRD name. */
export interface ParsedRef { providerName?: string; group: string; plural: string; }

/** Minimal discovery resource entry (`/apis/<group>/<version>` resources[]). */
export interface CrossplaneApiResource { name: string; kind: string; namespaced: boolean; }

export interface ManagedKindInfo {
    kindKey: string;          // `${group}/${version}/${plural}`, or `${group}//${plural}` when inactive
    group: string; plural: string;
    version?: string; kind?: string; namespaced?: boolean;
    servedVersions: string[];
    active: boolean;
    providerName?: string;
}

export interface ManagedKindsPayload extends CrossplanePayloadBase {
    providers: { name: string; health: CrossplaneHealth; kinds: ManagedKindInfo[] }[];
    unattributed: ManagedKindInfo[];
    providerConfigKinds: ManagedKindInfo[];
    source: 'objectRefs' | 'crdMetadata';
}

export interface ManagedKindScan {
    kindKey: string; providerName?: string; active: boolean;
    count: number; truncated: boolean; byHealth: HealthCounts;
    rowsCached: boolean; error?: CrossplaneSectionError;
}

export interface ManagedScanSummary extends CrossplanePayloadBase {
    context: string;
    status: 'complete' | 'cancelled';
    kinds: ManagedKindScan[];
    /** health `unhealthy`, capped at 200, sorted by healthOrder then healthSince. */
    unhealthy: ManagedRow[];
    scanned: number; total: number;
}

export interface ManagedItemsKindResult {
    kindKey: string; rows: ManagedRow[]; truncated: boolean; active: boolean; error?: CrossplaneSectionError;
}

export interface ManagedItemsPayload extends CrossplanePayloadBase { kinds: ManagedItemsKindResult[]; }

export interface CrossplaneEvent {
    uid: string; reason: string; message: string; count: number;
    involvedObject: CrossplaneObjectRef; timestamp: string;
}

export interface CrossplaneWarningEventsPayload extends CrossplanePayloadBase {
    events: CrossplaneEvent[]; truncatedScan: boolean; scanned: number;
}

export interface CrossplaneScanProgress { context: string; scanned: number; total: number; }

// ── Relationship tree ──

export type CrossplaneTreeNodeState = 'ok' | 'missing' | 'forbidden' | 'notFetched' | 'error';

export interface CrossplaneTreeNode {
    key: string; parentKey: string | null; ref: CrossplaneObjectRef;
    health: CrossplaneHealth; synced?: ConditionStatus; ready?: ConditionStatus; healthMessage?: string;
    state: CrossplaneTreeNodeState; depth: number; error?: string;
}

export interface CrossplaneTree {
    rootKey: string; focusKey: string; nodes: CrossplaneTreeNode[]; truncated: boolean; warnings: string[];
}

// ── Drawer ──

/** ref absent → render as plain text, never a link. */
export interface DrawerLink { label: string; ref?: CrossplaneObjectRef; text: string; }
