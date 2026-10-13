/** Raw Kubernetes objects for Crossplane unit tests (v1 and v2 shapes). */
import type { CrossplaneDetection } from '../../types/crossplane';

export const NOW = Date.parse('2025-01-01T12:00:00Z');
export const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();
export const MIN = 60_000;

type Cond = { type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string };
export const cond = (type: string, status: string, reason?: string, msAgo = MIN, message?: string): Cond => ({
    type, status, reason, message, lastTransitionTime: iso(msAgo),
});

let uidSeq = 0;
function meta(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    uidSeq++;
    return { name, uid: `uid-${name}-${uidSeq}`, creationTimestamp: iso(60 * MIN), resourceVersion: '1', ...extra };
}

// ── Packages ──

export const provider = {
    apiVersion: 'pkg.crossplane.io/v1', kind: 'Provider',
    metadata: meta('provider-aws-ec2'),
    spec: { package: 'xpkg.upbound.io/upbound/provider-aws-ec2:v1.0.0', runtimeConfigRef: { name: 'default' } },
    status: { currentRevision: 'provider-aws-ec2-abc', conditions: [cond('Installed', 'True'), cond('Healthy', 'True')] },
};
export const providerUnhealthy = {
    apiVersion: 'pkg.crossplane.io/v1', kind: 'Provider',
    metadata: meta('provider-broken'),
    spec: { package: 'xpkg.upbound.io/x/provider-broken:v0.1.0' },
    status: { conditions: [cond('Installed', 'True'), cond('Healthy', 'False', 'UnhealthyPackageRevision', MIN, 'pod crashloop')] },
};
export const fn = {
    apiVersion: 'pkg.crossplane.io/v1', kind: 'Function',
    metadata: meta('function-patch-and-transform'),
    spec: { package: 'xpkg.upbound.io/crossplane-contrib/function-patch-and-transform:v0.7.0' },
    status: { conditions: [cond('Installed', 'True'), cond('Healthy', 'True')] },
};
export const configuration = {
    apiVersion: 'pkg.crossplane.io/v1', kind: 'Configuration',
    metadata: meta('platform-ref'),
    spec: { package: 'xpkg.upbound.io/acme/platform-ref:v1.2.0' },
    status: { conditions: [cond('Installed', 'True'), cond('Healthy', 'Unknown', 'UnknownPackageRevisionHealth')] },
};

const revMeta = (name: string, pkg: string, extra: Record<string, unknown> = {}) => meta(name, {
    labels: { 'pkg.crossplane.io/package': pkg },
    ownerReferences: [{ apiVersion: 'pkg.crossplane.io/v1', kind: 'Provider', name: pkg, uid: 'owner-uid', controller: true }],
    ...extra,
});

/** v2 ProviderRevision: RevisionHealthy + RuntimeHealthy. */
export const providerRevisionV2 = {
    apiVersion: 'pkg.crossplane.io/v1', kind: 'ProviderRevision',
    metadata: revMeta('provider-aws-ec2-abc', 'provider-aws-ec2', { resourceVersion: '42' }),
    spec: { desiredState: 'Active', revision: 3, image: 'xpkg.upbound.io/upbound/provider-aws-ec2:v1.0.0' },
    status: {
        conditions: [cond('RevisionHealthy', 'True'), cond('RuntimeHealthy', 'True')],
        objectRefs: [
            { apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name: 'instances.ec2.aws.upbound.io' },
            { apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name: 'vpcs.ec2.aws.upbound.io' },
            { apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name: 'providerconfigs.aws.upbound.io' },
            { apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name: 'providerconfigusages.aws.upbound.io' },
            { apiVersion: 'apiextensions.crossplane.io/v1alpha1', kind: 'ManagedResourceDefinition', name: 'instances.ec2.aws.m.upbound.io' },
            { apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name: 'clusterproviderconfigs.aws.m.upbound.io' },
            { apiVersion: 'v1', kind: 'ServiceAccount', name: 'not-a-crd' },
            { apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name: 'INVALID' },
        ],
    },
};
/** v2 revision with a failing runtime. */
export const providerRevisionV2Unhealthy = {
    ...providerRevisionV2,
    metadata: revMeta('provider-broken-xyz', 'provider-broken'),
    status: { conditions: [cond('RevisionHealthy', 'True'), cond('RuntimeHealthy', 'False', 'Unavailable', MIN, 'deployment unavailable')] },
};
/** v1 revision: Healthy only. */
export const providerRevisionV1 = {
    apiVersion: 'pkg.crossplane.io/v1', kind: 'ProviderRevision',
    metadata: revMeta('provider-nop-v1', 'provider-nop', { resourceVersion: '7' }),
    spec: { desiredState: 'Active', revision: 1, image: 'xpkg.upbound.io/crossplane-contrib/provider-nop:v0.2.0' },
    status: {
        conditions: [cond('Healthy', 'True')],
        objectRefs: [{ apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name: 'nopresources.nop.crossplane.io' }],
    },
};
export const providerRevisionInactive = {
    apiVersion: 'pkg.crossplane.io/v1', kind: 'ProviderRevision',
    metadata: revMeta('provider-aws-ec2-old', 'provider-aws-ec2', { resourceVersion: '3' }),
    spec: { desiredState: 'Inactive', revision: 2, image: 'xpkg.upbound.io/upbound/provider-aws-ec2:v0.9.0' },
    status: {
        conditions: [cond('Healthy', 'False', 'UnhealthyPackageRevision')],
        objectRefs: [{ apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name: 'olds.legacy.example.io' }],
    },
};

export const runtimeConfig = {
    apiVersion: 'pkg.crossplane.io/v1beta1', kind: 'DeploymentRuntimeConfig', metadata: meta('default'), spec: {},
};
export const providerConfig = {
    apiVersion: 'aws.upbound.io/v1beta1', kind: 'ProviderConfig', metadata: meta('default'),
    spec: { credentials: { source: 'Secret', secretRef: { namespace: 'crossplane-system', name: 'aws-creds', key: 'creds' } } },
    status: { users: 4 },
};
/** v2 namespaced ProviderConfig. */
export const providerConfigNamespaced = {
    apiVersion: 'aws.m.upbound.io/v1beta1', kind: 'ProviderConfig', metadata: meta('team-a', { namespace: 'team-a' }),
    spec: { credentials: { source: 'IRSA' } },
};
export const activationPolicy = {
    apiVersion: 'apiextensions.crossplane.io/v1alpha1', kind: 'ManagedResourceActivationPolicy', metadata: meta('aws-core'),
    spec: { activate: ['*.ec2.aws.upbound.io', 'buckets.s3.aws.upbound.io'] },
    status: { activated: ['instances.ec2.aws.upbound.io'], conditions: [cond('Ready', 'True')] },
};
export const mrd = {
    apiVersion: 'apiextensions.crossplane.io/v1alpha1', kind: 'ManagedResourceDefinition',
    metadata: meta('instances.ec2.aws.m.upbound.io'),
    spec: { state: 'Active' },
    status: { conditions: [cond('Established', 'True'), cond('Healthy', 'True')] },
};

// ── Definitions ──

/** v1 LegacyCluster XRD with claim names (scope defaulted by the API server). */
export const xrdV1WithClaims = {
    apiVersion: 'apiextensions.crossplane.io/v1', kind: 'CompositeResourceDefinition',
    metadata: meta('xdatabases.platform.example.io'),
    spec: {
        group: 'platform.example.io',
        names: { kind: 'XDatabase', plural: 'xdatabases' },
        claimNames: { kind: 'Database', plural: 'databases' },
        defaultCompositionRef: { name: 'xdatabases-aws' },
        versions: [{ name: 'v1alpha1', served: true, referenceable: false }, { name: 'v1', served: true, referenceable: true }],
    },
    status: { conditions: [cond('Established', 'True'), cond('Offered', 'True')] },
};
/** v2 namespaced XRD with explicit scope, no claims. */
export const xrdV2Namespaced = {
    apiVersion: 'apiextensions.crossplane.io/v2', kind: 'CompositeResourceDefinition',
    metadata: meta('apps.platform.example.io'),
    spec: {
        group: 'platform.example.io', scope: 'Namespaced',
        names: { kind: 'App', plural: 'apps' },
        versions: [{ name: 'v1', served: true, referenceable: true }],
    },
    status: { conditions: [cond('Established', 'True')] },
};
/** v2 XRD without spec.scope → Namespaced by apiVersion. */
export const xrdV2NoScope = {
    ...xrdV2Namespaced,
    metadata: meta('buckets.platform.example.io'),
    spec: { group: 'platform.example.io', names: { kind: 'Bucket', plural: 'buckets' }, versions: [{ name: 'v1', served: true }] },
};
/** XRD with claimNames where Offered=False. */
export const xrdNotOffered = {
    ...xrdV1WithClaims,
    metadata: meta('xqueues.platform.example.io'),
    status: { conditions: [cond('Established', 'True'), cond('Offered', 'False', 'OfferFailed', MIN, 'claim CRD conflict')] },
};

export const composition = {
    apiVersion: 'apiextensions.crossplane.io/v1', kind: 'Composition',
    metadata: meta('xdatabases-aws', { labels: { provider: 'aws' } }),
    spec: {
        compositeTypeRef: { apiVersion: 'platform.example.io/v1', kind: 'XDatabase' },
        mode: 'Pipeline',
        pipeline: [
            { step: 'patch-and-transform', functionRef: { name: 'function-patch-and-transform' }, input: {} },
            { step: 'auto-ready', functionRef: { name: 'function-auto-ready' } },
        ],
    },
};
/** Composition whose composite type has no XRD in the definitions payload. */
export const compositionOrphan = {
    apiVersion: 'apiextensions.crossplane.io/v1', kind: 'Composition',
    metadata: meta('xorphans'),
    spec: { compositeTypeRef: { apiVersion: 'other.example.io/v1', kind: 'XOrphan' }, mode: 'Pipeline', pipeline: [] },
};
export const compositionRevision = {
    apiVersion: 'apiextensions.crossplane.io/v1', kind: 'CompositionRevision',
    metadata: meta('xdatabases-aws-1a2b3c', { labels: { 'crossplane.io/composition-name': 'xdatabases-aws' } }),
    spec: { revision: 2, compositeTypeRef: composition.spec.compositeTypeRef, pipeline: composition.spec.pipeline },
};
export const environmentConfig = {
    apiVersion: 'apiextensions.crossplane.io/v1beta1', kind: 'EnvironmentConfig',
    metadata: meta('env-prod'), data: { region: 'eu-west-1', tier: 'prod', secretish: 'never-render' },
};

// ── Composites ──

export const claim = {
    apiVersion: 'platform.example.io/v1', kind: 'Database',
    metadata: meta('orders-db', { namespace: 'team-a' }),
    spec: {
        compositionRef: { name: 'xdatabases-aws' },
        resourceRef: { apiVersion: 'platform.example.io/v1', kind: 'XDatabase', name: 'orders-db-x7k2p' },
        writeConnectionSecretToRef: { name: 'orders-db-conn' },
    },
    status: { conditions: [cond('Synced', 'True'), cond('Ready', 'True')] },
};
/** v1 LegacyCluster XR: spec.resourceRefs + spec.claimRef. */
export const xrV1 = {
    apiVersion: 'platform.example.io/v1', kind: 'XDatabase',
    metadata: meta('orders-db-x7k2p', {
        labels: { 'crossplane.io/claim-name': 'orders-db', 'crossplane.io/claim-namespace': 'team-a' },
    }),
    spec: {
        compositionRef: { name: 'xdatabases-aws' },
        compositionRevisionRef: { name: 'xdatabases-aws-1a2b3c' },
        claimRef: { apiVersion: 'platform.example.io/v1', kind: 'Database', name: 'orders-db', namespace: 'team-a' },
        resourceRefs: [
            { apiVersion: 'rds.aws.upbound.io/v1beta1', kind: 'Instance', name: 'orders-db-x7k2p-rds' },
            { apiVersion: 'ec2.aws.upbound.io/v1beta1', kind: 'SecurityGroup', name: 'orders-db-x7k2p-sg' },
            { apiVersion: 'v1', kind: 'Secret' },
        ],
        writeConnectionSecretToRef: { namespace: 'crossplane-system', name: 'orders-db-x7k2p' },
    },
    status: { conditions: [cond('Synced', 'False', 'ReconcileError', 5 * MIN, 'cannot compose resources')] },
};
/** v2 namespaced XR: spec.crossplane.resourceRefs + claim labels (no claimRef). */
export const xrV2 = {
    apiVersion: 'platform.example.io/v1', kind: 'XDatabase',
    metadata: meta('billing-db', {
        namespace: 'team-b',
        labels: { 'crossplane.io/claim-name': 'billing', 'crossplane.io/claim-namespace': 'team-b' },
    }),
    spec: {
        crossplane: {
            compositionRef: { name: 'xdatabases-aws' },
            resourceRefs: [{ apiVersion: 'rds.aws.m.upbound.io/v1beta1', kind: 'Instance', name: 'billing-db-rds' }],
        },
    },
    status: { conditions: [cond('Synced', 'True'), cond('Ready', 'False', 'Creating', 2 * MIN)] },
};

/** Legacy apiextensions Usage with resourceRef. */
export const usageRef = {
    apiVersion: 'apiextensions.crossplane.io/v1beta1', kind: 'Usage', metadata: meta('protect-db'),
    spec: {
        of: { apiVersion: 'rds.aws.upbound.io/v1beta1', kind: 'Instance', resourceRef: { name: 'orders-db-x7k2p-rds' } },
        by: { apiVersion: 'ec2.aws.upbound.io/v1beta1', kind: 'SecurityGroup', resourceRef: { name: 'orders-db-x7k2p-sg' } },
        reason: 'database in use', replayDeletion: true,
    },
    status: { conditions: [cond('Ready', 'True')] },
};
/** v2 namespaced protection Usage with a resourceSelector. */
export const usageSelector = {
    apiVersion: 'protection.crossplane.io/v1beta1', kind: 'Usage', metadata: meta('protect-vpc', { namespace: 'team-b' }),
    spec: {
        of: { apiVersion: 'ec2.aws.m.upbound.io/v1beta1', kind: 'VPC', resourceSelector: { matchLabels: { tier: 'net', env: 'prod' } } },
        by: { apiVersion: 'platform.example.io/v1', kind: 'XDatabase', resourceRef: { name: 'billing-db' } },
    },
    status: { conditions: [cond('Ready', 'False', 'ReconcileError', MIN, 'selector matched nothing')] },
};

export const operation = {
    apiVersion: 'ops.crossplane.io/v1alpha1', kind: 'Operation', metadata: meta('rotate-keys'),
    spec: { mode: 'Pipeline', pipeline: [{ step: 'rotate', functionRef: { name: 'function-rotate' } }] },
    status: { conditions: [cond('Succeeded', 'True')] },
};
export const operationRunning = {
    ...operation, metadata: meta('rotate-running'),
    status: { conditions: [cond('Succeeded', 'Unknown', 'PipelineRunning', 2 * MIN)] },
};
export const operationStuck = {
    ...operation, metadata: meta('rotate-stuck'),
    status: { conditions: [cond('Succeeded', 'Unknown', 'PipelineRunning', 16 * MIN)] },
};
export const operationFailed = {
    ...operation, metadata: meta('rotate-failed'),
    status: { conditions: [cond('Succeeded', 'False', 'PipelineError', MIN, 'function failed')] },
};
export const cronOperation = {
    apiVersion: 'ops.crossplane.io/v1alpha1', kind: 'CronOperation', metadata: meta('nightly'),
    spec: {
        schedule: '0 2 * * *',
        operationTemplate: { spec: { mode: 'Pipeline', pipeline: [{ step: 'a', functionRef: { name: 'function-a' } }, { step: 'b' }] } },
    },
    status: {
        lastScheduleTime: iso(10 * MIN), lastSuccessfulTime: iso(10 * MIN),
        runningOperationRefs: [{ name: 'nightly-1' }, { name: 'nightly-2' }],
        conditions: [cond('Synced', 'True'), cond('Scheduling', 'True')],
    },
};
export const watchOperation = {
    apiVersion: 'ops.crossplane.io/v1alpha1', kind: 'WatchOperation', metadata: meta('on-config'),
    spec: {
        watch: { apiVersion: 'v1', kind: 'ConfigMap', namespace: 'default' },
        operationTemplate: { spec: { mode: 'Pipeline', pipeline: [{ step: 'react', functionRef: { name: 'function-react' } }] } },
    },
    status: { watchingResources: 12, lastScheduleTime: iso(3 * MIN), conditions: [cond('Synced', 'True'), cond('Watching', 'True')] },
};

// ── Managed resources ──

const mr = (name: string, conditions: Cond[], extra: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) => ({
    apiVersion: 'ec2.aws.upbound.io/v1beta1', kind: 'Instance',
    metadata: meta(name, {
        annotations: { 'crossplane.io/external-name': `i-${name}` },
        labels: { 'crossplane.io/composite': 'orders-db-x7k2p', 'crossplane.io/claim-name': 'orders-db' },
        ownerReferences: [{ apiVersion: 'platform.example.io/v1', kind: 'XDatabase', name: 'orders-db-x7k2p', uid: 'xr-uid', controller: true }],
        ...extra,
    }),
    spec: {
        providerConfigRef: { name: 'default' }, deletionPolicy: 'Delete', managementPolicies: ['*'],
        forProvider: { region: 'eu-west-1' }, ...spec,
    },
    status: { conditions },
});

export const mrHealthy = mr('web-1', [cond('Synced', 'True'), cond('Ready', 'True')]);
export const mrCreatingFresh = mr('web-2', [cond('Synced', 'True'), cond('Ready', 'False', 'Creating', 2 * MIN)]);
export const mrCreatingStuck = mr('web-3', [cond('Synced', 'True'), cond('Ready', 'False', 'Creating', 16 * MIN)]);
export const mrReconcileError = mr('web-4', [cond('Synced', 'False', 'ReconcileError', MIN, 'cannot observe: AccessDenied'), cond('Ready', 'True')]);
export const mrAsyncFailed = mr('web-5', [
    cond('Synced', 'True'), cond('Ready', 'False', 'Creating', 2 * MIN),
    cond('LastAsyncOperation', 'False', 'ApplyFailure', MIN, 'InvalidParameterValue: bad AMI'),
]);
export const mrPaused = mr('web-6', [cond('Synced', 'True'), cond('Ready', 'True')], {
    annotations: { 'crossplane.io/paused': 'true' },
});
export const mrDeleting = mr('web-7', [cond('Synced', 'True'), cond('Ready', 'True')], { deletionTimestamp: iso(2 * MIN) });
export const mrNoConditions = mr('web-8', []);
/** v2 namespaced MR referencing a namespaced ProviderConfig. */
export const mrNamespaced = {
    ...mr('ns-web', [cond('Synced', 'True'), cond('Ready', 'True')], { namespace: 'team-a' }, { providerConfigRef: { name: 'team-a', kind: 'ProviderConfig' } }),
    apiVersion: 'ec2.aws.m.upbound.io/v1beta1',
};

export const warningEvent = (uid: string, apiVersion: string, ts: string, extra: Record<string, unknown> = {}) => ({
    apiVersion: 'v1', kind: 'Event', type: 'Warning',
    metadata: { uid, name: `ev-${uid}`, namespace: 'default', creationTimestamp: ts },
    involvedObject: { apiVersion, kind: 'Instance', name: 'web-4' },
    reason: 'CannotObserveExternalResource', message: 'AccessDenied', count: 3, lastTimestamp: ts,
    ...extra,
});

export const detection: CrossplaneDetection = {
    installed: true, coreRunning: true, version: 'v2.0.2', majorVersion: 2,
    kindVersions: {
        Provider: 'pkg.crossplane.io/v1', Function: 'pkg.crossplane.io/v1', Configuration: 'pkg.crossplane.io/v1',
        ProviderRevision: 'pkg.crossplane.io/v1', FunctionRevision: 'pkg.crossplane.io/v1', ConfigurationRevision: 'pkg.crossplane.io/v1',
        DeploymentRuntimeConfig: 'pkg.crossplane.io/v1beta1',
        CompositeResourceDefinition: 'apiextensions.crossplane.io/v2', Composition: 'apiextensions.crossplane.io/v1',
        CompositionRevision: 'apiextensions.crossplane.io/v1', EnvironmentConfig: 'apiextensions.crossplane.io/v1beta1',
        Usage: 'protection.crossplane.io/v1beta1', Operation: 'ops.crossplane.io/v1alpha1',
        CronOperation: 'ops.crossplane.io/v1alpha1', WatchOperation: 'ops.crossplane.io/v1alpha1',
    },
    features: {
        namespacedXrs: true, mrds: true, protectionUsages: true, legacyUsages: false,
        environmentConfigs: true, deploymentRuntimeConfigs: true, operations: true,
    },
    fetchedAt: iso(0),
};
