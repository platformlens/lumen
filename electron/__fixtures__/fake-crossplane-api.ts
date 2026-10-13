/**
 * In-memory CrossplaneApi for tests. Records every call (one call = one HTTP request), peak list
 * concurrency, and lets tests inject per-call errors or hold calls on a gate.
 */
import type { CrossplaneApiResource, CrossplaneObjectRef } from '../../src/types/crossplane';
import { CrossplaneApiError } from '../crossplane-api';
import type { ApiGroupInfo, CoreDeploymentInfo, CrossplaneApi, Gvr, ListPage, ListPageOptions } from '../crossplane-api';

export interface FakeCall { method: string; target: string; }
type ErrorRule = (call: FakeCall & { continueToken?: string }) => CrossplaneApiError | undefined;

export class FakeCrossplaneApi implements CrossplaneApi {
    readonly calls: FakeCall[] = [];
    groups: ApiGroupInfo[] = [];
    /** `group/version` (core: `/v1`) → resources */
    resources = new Map<string, CrossplaneApiResource[]>();
    /** `group/version/plural` → items */
    lists = new Map<string, unknown[]>();
    /** crossplaneKey-like `apiVersion|kind|namespace|name` → object */
    objects = new Map<string, unknown>();
    crds: unknown[] = [];
    events: unknown[] = [];
    deployment: CoreDeploymentInfo = { coreRunning: true, version: 'v2.0.0' };
    errorRules: ErrorRule[] = [];
    /** When set, every call awaits it first (to hold requests in flight). */
    gate: Promise<void> | null = null;
    activeLists = 0;
    peakLists = 0;
    invalidations = 0;

    constructor(readonly context = 'test') {}

    requestCount(): number { return this.calls.length; }
    invalidate(): void { this.invalidations++; }
    callsOf(method: string): FakeCall[] { return this.calls.filter(c => c.method === method); }

    private async enter(method: string, target: string, continueToken?: string): Promise<void> {
        const call = { method, target };
        this.calls.push(call);
        if (this.gate) await this.gate;
        await Promise.resolve();
        for (const rule of this.errorRules) {
            const err = rule({ ...call, continueToken });
            if (err) throw err;
        }
    }

    async getApiGroups(): Promise<ApiGroupInfo[]> {
        await this.enter('getApiGroups', '/apis');
        return this.groups.map(g => ({ ...g, versions: [...g.versions] }));
    }

    async getGroupResources(group: string, version: string): Promise<CrossplaneApiResource[]> {
        const key = `${group}/${version}`;
        await this.enter('getGroupResources', key);
        const r = this.resources.get(key);
        if (!r) throw new CrossplaneApiError(404, `${key} not found`);
        return r;
    }

    async listPage(gvr: Gvr, opts: ListPageOptions): Promise<ListPage> {
        const key = `${gvr.group}/${gvr.version}/${gvr.plural}`;
        this.activeLists++;
        this.peakLists = Math.max(this.peakLists, this.activeLists);
        try {
            await this.enter('listPage', key, opts.continueToken);
            await new Promise(r => setTimeout(r, 1));
            const items = this.lists.get(key);
            if (!items) throw new CrossplaneApiError(404, `${key} not found`);
            return paginate(items, opts.limit, opts.continueToken);
        } finally {
            this.activeLists--;
        }
    }

    async get(ref: CrossplaneObjectRef, plural?: string): Promise<unknown> {
        const key = `${ref.apiVersion}|${ref.kind}|${ref.namespace ?? ''}|${ref.name}`;
        await this.enter('get', `${key}${plural ? `|${plural}` : ''}`);
        const obj = this.objects.get(key);
        if (!obj) throw new CrossplaneApiError(404, `${key} not found`);
        return obj;
    }

    async listCrdMetadataPage(continueToken?: string): Promise<ListPage> {
        await this.enter('listCrdMetadataPage', 'crds', continueToken);
        return paginate(this.crds, 500, continueToken);
    }

    async listWarningEventsPage(continueToken?: string): Promise<ListPage> {
        await this.enter('listWarningEventsPage', 'events', continueToken);
        return paginate(this.events, 500, continueToken);
    }

    async findCoreDeployment(): Promise<CoreDeploymentInfo> {
        await this.enter('findCoreDeployment', 'deployments');
        return this.deployment;
    }

    // ── Builders ──

    addGroup(name: string, versions: string[], preferredVersion = versions[0]): void {
        this.groups.push({ name, versions, preferredVersion });
    }
    addResources(group: string, version: string, resources: CrossplaneApiResource[]): void {
        this.resources.set(`${group}/${version}`, resources);
    }
    addList(group: string, version: string, plural: string, items: unknown[]): void {
        this.lists.set(`${group}/${version}/${plural}`, items);
    }
    addObject(obj: { apiVersion: string; kind: string; metadata: { name: string; namespace?: string } }): void {
        this.objects.set(`${obj.apiVersion}|${obj.kind}|${obj.metadata.namespace ?? ''}|${obj.metadata.name}`, obj);
    }
    failWhen(rule: ErrorRule): void { this.errorRules.push(rule); }
}

function paginate(items: readonly unknown[], limit: number, continueToken?: string): ListPage {
    const start = continueToken ? Number(continueToken) : 0;
    const page = items.slice(start, start + limit);
    const next = start + limit;
    return next < items.length ? { items: page, continueToken: String(next) } : { items: page };
}

let uidSeq = 0;
/** Minimal object with name/uid and optional conditions. */
export function obj(
    apiVersion: string, kind: string, name: string,
    extra: { namespace?: string; spec?: Record<string, unknown>; status?: Record<string, unknown>; labels?: Record<string, string>; ownerReferences?: unknown[]; uid?: string; resourceVersion?: string } = {},
): { apiVersion: string; kind: string; metadata: { name: string; namespace?: string; uid: string; creationTimestamp: string; resourceVersion: string; labels?: Record<string, string>; ownerReferences?: unknown[] }; spec: Record<string, unknown>; status: Record<string, unknown> } {
    const metadata: { name: string; namespace?: string; uid: string; creationTimestamp: string; resourceVersion: string; labels?: Record<string, string>; ownerReferences?: unknown[] } = {
        name, uid: extra.uid ?? `uid-${++uidSeq}`, creationTimestamp: '2024-01-01T00:00:00Z', resourceVersion: extra.resourceVersion ?? '1',
    };
    if (extra.namespace) metadata.namespace = extra.namespace;
    if (extra.labels) metadata.labels = extra.labels;
    if (extra.ownerReferences) metadata.ownerReferences = extra.ownerReferences;
    return { apiVersion, kind, metadata, spec: extra.spec ?? {}, status: extra.status ?? {} };
}

export const READY = [
    { type: 'Synced', status: 'True', lastTransitionTime: '2024-01-01T00:00:00Z' },
    { type: 'Ready', status: 'True', lastTransitionTime: '2024-01-01T00:00:00Z' },
];
export const BROKEN = [
    { type: 'Synced', status: 'False', reason: 'ReconcileError', message: 'boom', lastTransitionTime: '2024-01-01T00:00:00Z' },
    { type: 'Ready', status: 'False', reason: 'Unavailable', lastTransitionTime: '2024-01-01T00:00:00Z' },
];

/** Many MR items of one kind (half broken when `broken`). */
export function managedItems(apiVersion: string, kind: string, n: number, broken = false): unknown[] {
    return Array.from({ length: n }, (_, i) => obj(apiVersion, kind, `${kind.toLowerCase()}-${i}`, {
        status: { conditions: broken && i % 2 === 0 ? BROKEN : READY },
    }));
}

/**
 * A Crossplane v2 cluster: core groups served, one provider family whose revision names MR kinds in
 * `ec2.example.io` (preferred v1beta2 serves only `instances`; v1beta1 serves `instances`, `vpcs`),
 * a ProviderConfig-only group `example.io`, and a group `unserved.example.io` that /apis does not serve.
 */
export function crossplaneCluster(api = new FakeCrossplaneApi()): FakeCrossplaneApi {
    const R = (name: string, kind: string, namespaced = false): CrossplaneApiResource => ({ name, kind, namespaced });
    api.addGroup('apiextensions.crossplane.io', ['v2', 'v1', 'v1alpha1']);
    api.addResources('apiextensions.crossplane.io', 'v2', [R('compositeresourcedefinitions', 'CompositeResourceDefinition')]);
    api.addResources('apiextensions.crossplane.io', 'v1', [
        R('compositeresourcedefinitions', 'CompositeResourceDefinition'), R('compositions', 'Composition'),
        R('compositionrevisions', 'CompositionRevision'),
    ]);
    api.addResources('apiextensions.crossplane.io', 'v1alpha1', [R('managedresourcedefinitions', 'ManagedResourceDefinition')]);
    api.addGroup('pkg.crossplane.io', ['v1', 'v1beta1']);
    api.addResources('pkg.crossplane.io', 'v1', [
        R('providers', 'Provider'), R('functions', 'Function'), R('configurations', 'Configuration'),
        R('providerrevisions', 'ProviderRevision'), R('functionrevisions', 'FunctionRevision'),
        R('configurationrevisions', 'ConfigurationRevision'),
    ]);
    api.addResources('pkg.crossplane.io', 'v1beta1', [R('deploymentruntimeconfigs', 'DeploymentRuntimeConfig')]);
    api.addGroup('ec2.example.io', ['v1beta2', 'v1beta1'], 'v1beta2');
    api.addResources('ec2.example.io', 'v1beta2', [R('instances', 'Instance'), R('instances/status', 'Instance')]);
    api.addResources('ec2.example.io', 'v1beta1', [R('instances', 'Instance'), R('vpcs', 'VPC'), R('subnets', 'Subnet'), R('bigs', 'Big')]);
    api.addGroup('example.io', ['v1beta1']);
    api.addResources('example.io', 'v1beta1', [R('providerconfigs', 'ProviderConfig')]);
    api.addGroup('platform.example.org', ['v1']);
    api.addResources('platform.example.org', 'v1', [R('xnetworks', 'XNetwork', true), R('networks', 'Network', true)]);

    const objectRefs = ['instances.ec2.example.io', 'vpcs.ec2.example.io', 'subnets.ec2.example.io', 'bigs.ec2.example.io',
        'providerconfigs.example.io', 'providerconfigusages.example.io', 'widgets.unserved.example.io']
        .map(name => ({ apiVersion: 'apiextensions.k8s.io/v1', kind: 'CustomResourceDefinition', name }));
    api.addList('pkg.crossplane.io', 'v1', 'providerrevisions', [
        obj('pkg.crossplane.io/v1', 'ProviderRevision', 'provider-example-abc', {
            labels: { 'pkg.crossplane.io/package': 'provider-example' }, resourceVersion: '7',
            spec: { desiredState: 'Active', revision: 1 },
            status: { objectRefs, conditions: [{ type: 'Healthy', status: 'True' }] },
        }),
    ]);
    api.addList('pkg.crossplane.io', 'v1', 'providers', [obj('pkg.crossplane.io/v1', 'Provider', 'provider-example', {
        spec: { package: 'xpkg.example.io/provider-example:v1' },
        status: { currentRevision: 'provider-example-abc', conditions: [{ type: 'Installed', status: 'True' }, { type: 'Healthy', status: 'True' }] },
    })]);
    api.addList('pkg.crossplane.io', 'v1', 'functions', [obj('pkg.crossplane.io/v1', 'Function', 'function-patch', {
        status: { conditions: [{ type: 'Installed', status: 'True' }, { type: 'Healthy', status: 'True' }] },
    })]);
    api.addList('pkg.crossplane.io', 'v1', 'configurations', []);
    api.addList('pkg.crossplane.io', 'v1', 'functionrevisions', []);
    api.addList('pkg.crossplane.io', 'v1', 'configurationrevisions', []);
    api.addList('pkg.crossplane.io', 'v1beta1', 'deploymentruntimeconfigs', []);
    api.addList('example.io', 'v1beta1', 'providerconfigs', [obj('example.io/v1beta1', 'ProviderConfig', 'default')]);
    api.addList('ec2.example.io', 'v1beta1', 'vpcs', []);
    api.addList('ec2.example.io', 'v1beta2', 'instances', managedItems('ec2.example.io/v1beta2', 'Instance', 1200, true));
    api.addList('ec2.example.io', 'v1beta1', 'subnets', managedItems('ec2.example.io/v1beta1', 'Subnet', 3));
    api.addList('ec2.example.io', 'v1beta1', 'bigs', managedItems('ec2.example.io/v1beta1', 'Big', 6000));

    api.addList('apiextensions.crossplane.io', 'v2', 'compositeresourcedefinitions', [
        obj('apiextensions.crossplane.io/v2', 'CompositeResourceDefinition', 'xnetworks.platform.example.org', {
            spec: {
                group: 'platform.example.org', scope: 'Namespaced', names: { kind: 'XNetwork', plural: 'xnetworks' },
                claimNames: { kind: 'Network', plural: 'networks' },
                versions: [{ name: 'v1', served: true, referenceable: true }],
            },
            status: { conditions: [{ type: 'Established', status: 'True' }, { type: 'Offered', status: 'True' }] },
        }),
    ]);
    api.addList('apiextensions.crossplane.io', 'v1', 'compositions', [obj('apiextensions.crossplane.io/v1', 'Composition', 'xnetworks', {
        spec: { compositeTypeRef: { apiVersion: 'platform.example.org/v1', kind: 'XNetwork' }, mode: 'Pipeline',
            pipeline: [{ step: 'patch', functionRef: { name: 'function-patch' } }] },
    })]);
    api.addList('apiextensions.crossplane.io', 'v1', 'compositionrevisions', []);
    api.addList('platform.example.org', 'v1', 'xnetworks', []);
    api.addList('platform.example.org', 'v1', 'networks', []);
    return api;
}
