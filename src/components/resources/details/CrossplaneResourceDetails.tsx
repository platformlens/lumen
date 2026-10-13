import React, { useCallback, useMemo, useState } from 'react';
import { FileCode, GitBranch, List, Sparkles } from 'lucide-react';
import type {
    CrossplaneCategory, CrossplaneDefinitionsPayload, CrossplaneDetection, CrossplaneHealth, CrossplaneObjectRef,
    CrossplanePackagesPayload, CrossplaneRowBase,
} from '../../../types/crossplane';
import { useCrossplaneQuery } from '../../../hooks/useCrossplaneQuery';
import {
    asString, classifyCrossplaneObject, crossplaneKey, deriveObjectHealth, getConditions, getPath, toCrossplaneRef,
} from '../../../utils/crossplane-utils';
import { resolveDrawerRefs } from '../../../utils/crossplane-drawer-refs';
import { ToggleGroup } from '../../shared/ToggleGroup';
import type { ToggleOption } from '../../shared/ToggleGroup';
import { TimeAgo } from '../../shared/TimeAgo';
import { CrossplaneConditionPill, CrossplaneHealthBadge } from '../../dashboard/views/crossplane/CrossplaneHealthBadge';
import { CrossplaneDetailSections } from './CrossplaneDetailSections';
import type { CrossplaneDrawerExtras } from './CrossplaneDetailSections';
import { CrossplaneTreeGraph, CrossplaneTreeStatus } from '../visualizers/CrossplaneTreeGraph';
import { CrossplaneTreeList } from '../visualizers/CrossplaneTreeList';

interface CrossplaneResourceDetailsProps {
    clusterName: string;
    /** Full object from crossplane:getResource. */
    object: unknown;
    /** The selected row/ref; only `category` is read, as a hint. */
    refHint?: { category?: CrossplaneCategory } | null;
    onOpenResource: (ref: CrossplaneObjectRef) => void;
    onOpenYaml?: () => void;
    onExplain?: () => void;
}

type DrawerTab = 'details' | 'relationships';
type RelationMode = 'graph' | 'list';

const PACKAGE_EXTRAS: ReadonlySet<CrossplaneCategory> = new Set<CrossplaneCategory>([
    'provider', 'function', 'configuration', 'packageRevision', 'runtimeConfig', 'providerConfig', 'activationPolicy',
]);
const DEFINITION_EXTRAS: ReadonlySet<CrossplaneCategory> = new Set<CrossplaneCategory>(['xrd', 'composition', 'compositionRevision']);
const RELATIONSHIP_CATEGORIES: ReadonlySet<CrossplaneCategory> = new Set<CrossplaneCategory>(['claim', 'composite', 'managed']);
/** managed needs getPackages only for the providerConfigRef link (AM-2). */
const PACKAGE_LINK_CATEGORIES: ReadonlySet<CrossplaneCategory> = new Set<CrossplaneCategory>([...PACKAGE_EXTRAS, 'managed']);

const NO_DETECTION: CrossplaneDetection = {
    installed: true, coreRunning: null, version: null, majorVersion: null, kindVersions: {}, fetchedAt: '',
    features: {
        namespacedXrs: false, mrds: false, protectionUsages: false, legacyUsages: false,
        environmentConfigs: false, deploymentRuntimeConfigs: false, operations: false,
    },
};

const BANNER_STYLES: Record<CrossplaneHealth, string> = {
    unhealthy: 'bg-red-500/10 border-red-500/20',
    progressing: 'bg-yellow-500/10 border-yellow-500/20',
    healthy: 'bg-green-500/10 border-green-500/20',
    paused: 'bg-white/5 border-white/10',
    unknown: 'bg-white/5 border-white/10',
    none: 'bg-white/5 border-white/10',
};

function findPackageRow(category: CrossplaneCategory, key: string, p: CrossplanePackagesPayload | null): CrossplaneRowBase | undefined {
    if (!p) return undefined;
    const lists: Partial<Record<CrossplaneCategory, readonly CrossplaneRowBase[]>> = {
        provider: p.providers, function: p.functions, configuration: p.configurations, packageRevision: p.revisions,
        runtimeConfig: p.runtimeConfigs, providerConfig: p.providerConfigs, activationPolicy: p.activationPolicies,
    };
    return lists[category]?.find(r => r.key === key);
}

function findDefinitionRow(category: CrossplaneCategory, key: string, d: CrossplaneDefinitionsPayload | null): CrossplaneRowBase | undefined {
    if (!d) return undefined;
    const lists: Partial<Record<CrossplaneCategory, readonly CrossplaneRowBase[]>> = {
        xrd: d.xrds, composition: d.compositions, compositionRevision: d.compositionRevisions,
    };
    return lists[category]?.find(r => r.key === key);
}

/** Drawer body for type 'crossplane'. Read-only: no mutating actions are offered here. */
export const CrossplaneResourceDetails: React.FC<CrossplaneResourceDetailsProps> = ({
    clusterName, object, refHint, onOpenResource, onOpenYaml, onExplain,
}) => {
    const [tab, setTab] = useState<DrawerTab>('details');
    const [mode, setMode] = useState<RelationMode>('graph');

    const apiVersion = asString(getPath(object, 'apiVersion'));
    const kind = asString(getPath(object, 'kind'));
    const name = asString(getPath(object, 'metadata', 'name'));
    const namespace = asString(getPath(object, 'metadata', 'namespace'));
    const objRef = useMemo<CrossplaneObjectRef | null>(
        () => (apiVersion && kind && name ? { apiVersion, kind, name, ...(namespace ? { namespace } : {}) } : null),
        [apiVersion, kind, name, namespace],
    );
    const key = objRef ? crossplaneKey(objRef) : '';

    const detect = useCrossplaneQuery((force) => window.k8s.crossplane.detect(clusterName, { force }), `${clusterName}|detect`, { autoRefresh: false });
    const defs = useCrossplaneQuery((force) => window.k8s.crossplane.getDefinitions(clusterName, { force }), `${clusterName}|definitions`, { autoRefresh: false });

    // AM-1: classifier first, then the row hint, then null (generic sections only). Never defaults to managed.
    // Without the XRD list an XR/claim would classify as managed, so wait for definitions (or use the hint).
    const classified = classifyCrossplaneObject(object, defs.data);
    const hint = refHint?.category ?? null;
    const defsSettled = defs.data !== null || defs.error !== null;
    const pending = classified === 'managed' && !defs.data && !hint && !defsSettled;
    const category: CrossplaneCategory | null = classified === 'managed' && !defs.data
        ? (hint ?? (defsSettled ? 'managed' : null))
        : (classified ?? hint ?? null);

    const needPackages = !!category && PACKAGE_LINK_CATEGORIES.has(category);
    const needComposites = !!category && DEFINITION_EXTRAS.has(category);
    const pkgs = useCrossplaneQuery((force) => window.k8s.crossplane.getPackages(clusterName, { force }), `${clusterName}|packages`, { autoRefresh: false, enabled: needPackages });
    const comps = useCrossplaneQuery((force) => window.k8s.crossplane.getComposites(clusterName, { force }), `${clusterName}|composites`, { autoRefresh: false, enabled: needComposites });

    const health = useMemo(() => deriveObjectHealth(category ?? 'generic', object, Date.now()), [category, object]);
    const conditions = useMemo(() => getConditions(object), [object]);

    const links = useMemo(() => resolveDrawerRefs(category, object, {
        detection: detect.data ?? NO_DETECTION,
        packages: pkgs.data ?? undefined,
        definitions: defs.data ?? undefined,
    }), [category, object, detect.data, pkgs.data, defs.data]);

    const extras = useMemo<CrossplaneDrawerExtras>(() => {
        if (pending) return { needed: true, loading: true, error: null };
        if (category && PACKAGE_EXTRAS.has(category)) {
            return {
                needed: true, loading: !pkgs.data && !pkgs.error, error: pkgs.error,
                row: findPackageRow(category, key, pkgs.data),
            };
        }
        if (category && DEFINITION_EXTRAS.has(category)) {
            return {
                needed: true, loading: (!defs.data && !defs.error) || (!comps.data && !comps.error),
                error: defs.error ?? comps.error, row: findDefinitionRow(category, key, defs.data),
                definitions: defs.data, composites: comps.data,
            };
        }
        return { needed: false, loading: false, error: null };
    }, [pending, category, key, pkgs.data, pkgs.error, defs.data, defs.error, comps.data, comps.error]);

    const showRelationships = !!category && RELATIONSHIP_CATEGORIES.has(category);
    const treeRef = useMemo(() => (objRef ? toCrossplaneRef({ ...objRef, ...(category ? { category } : {}) }) : null), [objRef, category]);
    const tree = useCrossplaneQuery(
        () => (treeRef ? window.k8s.crossplane.getTree(clusterName, treeRef) : Promise.reject(new Error('Object has no apiVersion/kind/name'))),
        `${clusterName}|tree|${key}`,
        { autoRefresh: false, enabled: tab === 'relationships' && !!treeRef },
    );
    const retryTree = tree.refresh;
    const onTabChange = useCallback((t: DrawerTab) => setTab(t), []);

    const tabOptions = useMemo<ToggleOption<DrawerTab>[]>(() => [
        { value: 'details', label: 'Details' },
        objRef
            ? { value: 'relationships', label: 'Relationships', icon: GitBranch }
            : { value: 'relationships', label: 'Relationships', icon: GitBranch, disabled: true, title: 'Object has no apiVersion/kind/name' },
    ], [objRef]);
    const modeOptions = useMemo<ToggleOption<RelationMode>[]>(() => [
        { value: 'graph', label: 'Graph', icon: GitBranch },
        { value: 'list', label: 'List', icon: List },
    ], []);

    return (
        <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white break-all">{name ?? 'Unnamed object'}</h3>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">{kind ?? 'Unknown kind'}</span>
                            {namespace && <span className="text-sm text-gray-400 bg-white/5 px-2 py-1 rounded-md">{namespace}</span>}
                            <span className="text-xs text-gray-500 font-mono">{apiVersion}</span>
                        </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        {onExplain && (
                            <button type="button" onClick={onExplain} title="Explain with AI" className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 rounded-lg transition-colors">
                                <Sparkles size={14} aria-hidden="true" /><span className="sr-only">Explain with AI</span>
                            </button>
                        )}
                        {onOpenYaml && (
                            <button type="button" onClick={onOpenYaml} title="View YAML" className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 rounded-lg transition-colors">
                                <FileCode size={14} aria-hidden="true" /><span className="sr-only">View YAML</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className={`border rounded-xl p-4 space-y-1 ${BANNER_STYLES[health.health]}`} role="status">
                <div className="flex items-center gap-2">
                    <CrossplaneHealthBadge health={health.health} reason={health.reason} />
                    {health.reason && <span className="text-sm text-gray-200 font-medium">{health.reason}</span>}
                    {health.since && <span className="text-xs text-gray-500 ml-auto">since <TimeAgo timestamp={health.since} /></span>}
                </div>
                {health.message && <p className="text-sm text-gray-300 break-words">{health.message}</p>}
            </div>

            {showRelationships && <ToggleGroup options={tabOptions} value={tab} onChange={onTabChange} />}

            {tab === 'relationships' && showRelationships ? (
                <div className="space-y-3">
                    <ToggleGroup options={modeOptions} value={mode} onChange={setMode} />
                    {mode === 'graph' ? (
                        <CrossplaneTreeGraph tree={tree.data} loading={tree.loading} error={tree.error} onRetry={retryTree} onOpenResource={onOpenResource} />
                    ) : (
                        <CrossplaneTreeStatus tree={tree.data} loading={tree.loading} error={tree.error} onRetry={retryTree}>
                            {(t) => <CrossplaneTreeList tree={t} onOpenResource={onOpenResource} />}
                        </CrossplaneTreeStatus>
                    )}
                </div>
            ) : (
                <>
                    <section className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                        <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider">Conditions</h3>
                        {conditions.length === 0 ? <p className="text-sm text-gray-500">No conditions reported</p> : (
                            <table className="w-full text-sm">
                                <thead><tr className="text-gray-400 text-xs text-left border-b border-white/10">
                                    <th className="py-1 font-medium">Type</th><th className="py-1 font-medium">Status</th>
                                    <th className="py-1 font-medium">Reason</th><th className="py-1 font-medium">Changed</th>
                                </tr></thead>
                                <tbody className="divide-y divide-white/5">
                                    {conditions.map(c => (
                                        <tr key={c.type} className="align-top">
                                            <td className="py-1.5 text-gray-300">{c.type}</td>
                                            <td className="py-1.5"><CrossplaneConditionPill status={c.status} /></td>
                                            <td className="py-1.5 text-gray-300">
                                                {c.reason ?? '—'}
                                                {c.message && <div className="text-xs text-gray-400 break-words">{c.message}</div>}
                                            </td>
                                            <td className="py-1.5 text-xs text-gray-500">{c.lastTransitionTime ? <TimeAgo timestamp={c.lastTransitionTime} /> : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </section>
                    {pending ? (
                        <div className="space-y-2 animate-pulse" aria-label="Loading">
                            <div className="h-20 bg-white/5 rounded-xl" />
                        </div>
                    ) : (
                        <CrossplaneDetailSections category={category} object={object} links={links} extras={extras} onOpenResource={onOpenResource} />
                    )}
                </>
            )}
        </div>
    );
};
