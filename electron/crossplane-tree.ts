// Portions adapted from crossplane-contrib/crossview (Apache-2.0),
// https://github.com/crossplane-contrib/crossview @ 8443621. Modified for Lumen.
/**
 * Relationship tree walk for the Crossplane drawer (design B.7 steps 0–6).
 * Ascends from the requested object to its top-most XR/claim, then descends breadth-first through
 * claim `spec.resourceRef` and XR resourceRefs. Core v1 Secrets are never fetched.
 */
import type {
    CrossplaneDefinitionsPayload, CrossplaneObjectRef, CrossplaneTree, CrossplaneTreeNode, XrdRow,
} from '../src/types/crossplane';
import { asString, getPath } from '../src/utils/crossplane-guards';
import {
    classifyCrossplaneObject, conditionStatus, crossplaneKey, deriveObjectHealth, findXrdFor, getClaimRef,
    getConditions, getControllerOwner, getResourceRefs,
} from '../src/utils/crossplane-utils';
import { createLimiter, toCrossplaneApiError } from './crossplane-api';

export const TREE_MAX_DEPTH = 6;
export const TREE_MAX_NODES = 300;
export const TREE_MAX_ASCENT = 4;
export const TREE_CONCURRENCY = 8;

export interface TreeDeps {
    getDefinitions: () => Promise<CrossplaneDefinitionsPayload>;
    /** GET one object (plural resolved by the caller). */
    getObject: (ref: CrossplaneObjectRef) => Promise<unknown>;
    /** Whether `kind` at `apiVersion` is namespaced (discovery cache), undefined if unknown. */
    isNamespaced: (apiVersion: string, kind: string) => Promise<boolean | undefined>;
    now: number;
}

export function isSecretRef(ref: { apiVersion: string; kind: string }): boolean {
    return ref.apiVersion === 'v1' && ref.kind === 'Secret';
}

function refOf(obj: unknown): CrossplaneObjectRef | undefined {
    const apiVersion = asString(getPath(obj, 'apiVersion'));
    const kind = asString(getPath(obj, 'kind'));
    const name = asString(getPath(obj, 'metadata', 'name'));
    if (!apiVersion || !kind || !name) return undefined;
    const namespace = asString(getPath(obj, 'metadata', 'namespace'));
    return namespace ? { apiVersion, kind, name, namespace } : { apiVersion, kind, name };
}

function isNamespacedScope(xrd: XrdRow): boolean {
    return xrd.scope === 'Namespaced';
}

/** The next object up: controller owner if it is a known XR kind, else the claim of an XR. */
function parentRef(obj: unknown, xrds: readonly XrdRow[]): CrossplaneObjectRef | undefined {
    const ns = asString(getPath(obj, 'metadata', 'namespace'));
    const owner = getControllerOwner(obj);
    if (owner) {
        const hit = findXrdFor(owner.apiVersion, owner.kind, xrds);
        if (hit?.role === 'composite') {
            const ref: CrossplaneObjectRef = { apiVersion: owner.apiVersion, kind: owner.kind, name: owner.name };
            if (ns && isNamespacedScope(hit.xrd)) ref.namespace = ns;
            return ref;
        }
    }
    const self = refOf(obj);
    const selfXrd = self ? findXrdFor(self.apiVersion, self.kind, xrds) : undefined;
    if (selfXrd?.role !== 'composite') return undefined;
    const claim = getClaimRef(obj);
    if (!claim) return undefined;
    const apiVersion = claim.apiVersion ?? (selfXrd.xrd.claimKind ? `${selfXrd.xrd.group}/${selfXrd.xrd.version}` : undefined);
    const kind = claim.kind ?? selfXrd.xrd.claimKind;
    if (!apiVersion || !kind) return undefined;
    const ns2 = claim.namespace ?? ns;
    return ns2 ? { apiVersion, kind, name: claim.name, namespace: ns2 } : { apiVersion, kind, name: claim.name };
}

/** Children of a claim (`spec.resourceRef`) or an XR (resourceRefs); nothing for other objects. */
function childRefs(obj: unknown, xrds: readonly XrdRow[]): CrossplaneObjectRef[] {
    const self = refOf(obj);
    const hit = self ? findXrdFor(self.apiVersion, self.kind, xrds) : undefined;
    if (hit?.role === 'claim') {
        const rr = getPath(obj, 'spec', 'resourceRef');
        const apiVersion = asString(getPath(rr, 'apiVersion'));
        const kind = asString(getPath(rr, 'kind'));
        const name = asString(getPath(rr, 'name'));
        return apiVersion && kind && name ? [{ apiVersion, kind, name }] : [];
    }
    if (hit?.role === 'composite' || !hit) return getResourceRefs(obj);
    return [];
}

export async function walkCrossplaneTree(root: CrossplaneObjectRef, deps: TreeDeps): Promise<CrossplaneTree> {
    const warnings: string[] = [];
    // Step 0: XRD set.
    let definitions: CrossplaneDefinitionsPayload | null = null;
    try {
        definitions = await deps.getDefinitions();
    } catch (e) {
        const msg = toCrossplaneApiError(e).message;
        console.warn(`[crossplane] tree: definitions unavailable: ${msg}`);
        warnings.push(`Definitions unavailable: ${msg}`);
    }
    const xrds = definitions?.xrds ?? [];

    // Step 1: root (failure rejects).
    const rootObj = await deps.getObject(root);
    const focusKey = crossplaneKey(refOf(rootObj) ?? root);

    // Step 2: ascend.
    let top = rootObj;
    for (let i = 0; i < TREE_MAX_ASCENT; i++) {
        const up = parentRef(top, xrds);
        if (!up || isSecretRef(up)) break;
        try {
            top = await deps.getObject(up);
        } catch (e) {
            warnings.push(`Could not load ${up.kind} ${up.name}: ${toCrossplaneApiError(e).message}`);
            break;
        }
    }

    // Steps 3–5: BFS descend.
    const nodes: CrossplaneTreeNode[] = [];
    const seen = new Set<string>();
    let truncated = false;
    const limit = createLimiter(TREE_CONCURRENCY);

    const okNode = (obj: unknown, fallback: CrossplaneObjectRef, parentKey: string | null, depth: number): CrossplaneTreeNode => {
        const ref = refOf(obj) ?? fallback;
        const category = classifyCrossplaneObject(obj, definitions) ?? undefined;
        const h = deriveObjectHealth(category ?? 'generic', obj, deps.now);
        const conditions = getConditions(obj);
        const node: CrossplaneTreeNode = {
            key: crossplaneKey(ref), parentKey, ref: category ? { ...ref, category } : ref,
            health: h.health, state: 'ok', depth,
        };
        const synced = conditionStatus(conditions, 'Synced');
        const ready = conditionStatus(conditions, 'Ready');
        if (synced) node.synced = synced;
        if (ready) node.ready = ready;
        if (h.message) node.healthMessage = h.message;
        return node;
    };
    const markSeen = (obj: unknown, key: string): boolean => {
        const id = asString(getPath(obj, 'metadata', 'uid')) ?? key;
        if (seen.has(id) || seen.has(key)) return false;
        seen.add(id);
        seen.add(key);
        return true;
    };

    const topNode = okNode(top, root, null, 0);
    markSeen(top, topNode.key);
    nodes.push(topNode);
    let frontier: { obj: unknown; node: CrossplaneTreeNode }[] = [{ obj: top, node: topNode }];

    while (frontier.length > 0) {
        const next: { obj: unknown; node: CrossplaneTreeNode }[] = [];
        const jobs: Promise<void>[] = [];
        for (const parent of frontier) {
            const refs = childRefs(parent.obj, xrds);
            if (refs.length === 0) continue;
            if (parent.node.depth >= TREE_MAX_DEPTH) { truncated = true; continue; }
            const parentNs = parent.node.ref.namespace;
            for (const raw of refs) {
                if (nodes.length + jobs.length >= TREE_MAX_NODES) { truncated = true; break; }
                jobs.push(limit(async () => {
                    let ref: CrossplaneObjectRef = raw;
                    if (!raw.namespace && parentNs && (await deps.isNamespaced(raw.apiVersion, raw.kind).catch(() => undefined))) {
                        ref = { ...raw, namespace: parentNs };
                    }
                    const key = crossplaneKey(ref);
                    const depth = parent.node.depth + 1;
                    const stub = (state: CrossplaneTreeNode['state'], error?: string): CrossplaneTreeNode => {
                        const category = classifyCrossplaneObject(ref, definitions) ?? undefined;
                        const n: CrossplaneTreeNode = {
                            key, parentKey: parent.node.key, ref: category ? { ...ref, category } : ref,
                            health: state === 'notFetched' ? 'none' : 'unknown', state, depth,
                        };
                        if (error) n.error = error;
                        return n;
                    };
                    if (isSecretRef(ref)) {
                        if (!seen.has(key)) { seen.add(key); nodes.push(stub('notFetched')); }
                        return;
                    }
                    try {
                        const obj = await deps.getObject(ref);
                        const node = okNode(obj, ref, parent.node.key, depth);
                        if (!markSeen(obj, node.key)) return;
                        nodes.push(node);
                        next.push({ obj, node });
                    } catch (e) {
                        if (seen.has(key)) return;
                        seen.add(key);
                        const err = toCrossplaneApiError(e);
                        nodes.push(err.status === 404 ? stub('missing') : err.status === 403 ? stub('forbidden') : stub('error', err.message));
                    }
                }));
            }
        }
        await Promise.all(jobs);
        frontier = next;
    }
    if (nodes.length > TREE_MAX_NODES) {
        nodes.length = TREE_MAX_NODES;
        truncated = true;
    }
    return { rootKey: topNode.key, focusKey, nodes, truncated, warnings };
}
