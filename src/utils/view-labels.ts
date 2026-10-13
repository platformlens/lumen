/** Maps view IDs to human-readable labels for the tab bar. */
const VIEW_LABELS: Record<string, string> = {
    'overview': 'Overview',
    'pods': 'Pods',
    'deployments': 'Deployments',
    'nodes': 'Nodes',
    'namespaces': 'Namespaces',
    'daemonsets': 'DaemonSets',
    'statefulsets': 'StatefulSets',
    'replicasets': 'ReplicaSets',
    'jobs': 'Jobs',
    'cronjobs': 'CronJobs',
    'services': 'Services',
    'endpointslices': 'Endpoint Slices',
    'endpoints': 'Endpoints',
    'ingresses': 'Ingresses',
    'ingressclasses': 'Ingress Classes',
    'networkpolicies': 'Network Policies',
    'persistentvolumeclaims': 'PVCs',
    'persistentvolumes': 'PVs',
    'storageclasses': 'Storage Classes',
    'configmaps': 'ConfigMaps',
    'secrets': 'Secrets',
    'horizontalpodautoscalers': 'HPAs',
    'poddisruptionbudgets': 'PDBs',
    'mutatingwebhookconfigurations': 'Mutating Webhooks',
    'validatingwebhookconfigurations': 'Validating Webhooks',
    'priorityclasses': 'Priority Classes',
    'runtimeclasses': 'Runtime Classes',
    'helm-releases': 'Helm Releases',
    'helm-charts': 'Helm Charts',
    'clusterroles': 'Cluster Roles',
    'clusterrolebindings': 'Cluster Role Bindings',
    'roles': 'Roles',
    'rolebindings': 'Role Bindings',
    'serviceaccounts': 'Service Accounts',
    'certificates': 'Cert Manager',
    'aws': 'AWS',
    'crd-definitions': 'CRD Definitions',
    'crossplane-overview': 'Crossplane',
    'crossplane-packages': 'XP Packages',
    'crossplane-definitions': 'XP Definitions',
    'crossplane-composites': 'XP Composites',
    'crossplane-managed': 'XP Managed',
};

export const DEPLOYMENT_DETAIL_PREFIX = 'deployment-detail/';

/** `deployment-detail/<ns>/<name>` with each segment URI-encoded. */
export function buildDeploymentDetailViewId(namespace: string, name: string): string {
    return `${DEPLOYMENT_DETAIL_PREFIX}${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}

/** Inverse of buildDeploymentDetailViewId; null for any malformed id. */
export function parseDeploymentDetailViewId(viewId: string): { namespace: string; name: string } | null {
    if (!viewId.startsWith(DEPLOYMENT_DETAIL_PREFIX)) return null;
    const segments = viewId.split('/');
    if (segments.length !== 3) return null;
    const [, rawNs, rawName] = segments;
    if (!rawNs || !rawName) return null;
    try {
        const namespace = decodeURIComponent(rawNs);
        const name = decodeURIComponent(rawName);
        if (!namespace || !name) return null;
        return { namespace, name };
    } catch {
        return null;
    }
}

export function getViewLabel(viewId: string): string {
    if (VIEW_LABELS[viewId]) return VIEW_LABELS[viewId];
    if (viewId.startsWith(DEPLOYMENT_DETAIL_PREFIX)) {
        const parsed = parseDeploymentDetailViewId(viewId);
        return parsed ? `Deploy: ${parsed.name}` : 'Deployment';
    }
    if (viewId.startsWith('helm-chart-detail/')) {
        const chart = viewId.split('/')[2];
        return chart ? `Chart: ${decodeURIComponent(chart)}` : 'Helm chart';
    }
    // CRD views: crd/group/version/plural → extract the plural and capitalize
    if (viewId.startsWith('crd/')) {
        const parts = viewId.split('/');
        const plural = parts[parts.length - 1] || viewId;
        return plural.charAt(0).toUpperCase() + plural.slice(1);
    }
    return viewId;
}
