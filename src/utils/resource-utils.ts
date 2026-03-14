export const RESOURCE_TYPE_MAP: Record<string, { apiVersion: string; kind: string; namespaced: boolean }> = {
    'deployment': { apiVersion: 'apps/v1', kind: 'Deployment', namespaced: true },
    'daemonset': { apiVersion: 'apps/v1', kind: 'DaemonSet', namespaced: true },
    'statefulset': { apiVersion: 'apps/v1', kind: 'StatefulSet', namespaced: true },
    'replicaset': { apiVersion: 'apps/v1', kind: 'ReplicaSet', namespaced: true },
    'pod': { apiVersion: 'v1', kind: 'Pod', namespaced: true },
    'service': { apiVersion: 'v1', kind: 'Service', namespaced: true },
    'configmap': { apiVersion: 'v1', kind: 'ConfigMap', namespaced: true },
    'secret': { apiVersion: 'v1', kind: 'Secret', namespaced: true },
    'namespace': { apiVersion: 'v1', kind: 'Namespace', namespaced: false },
    'node': { apiVersion: 'v1', kind: 'Node', namespaced: false },
    'persistentvolumeclaim': { apiVersion: 'v1', kind: 'PersistentVolumeClaim', namespaced: true },
    'persistentvolume': { apiVersion: 'v1', kind: 'PersistentVolume', namespaced: false },
    'serviceaccount': { apiVersion: 'v1', kind: 'ServiceAccount', namespaced: true },
    'job': { apiVersion: 'batch/v1', kind: 'Job', namespaced: true },
    'cronjob': { apiVersion: 'batch/v1', kind: 'CronJob', namespaced: true },
    'ingress': { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', namespaced: true },
    'ingressclass': { apiVersion: 'networking.k8s.io/v1', kind: 'IngressClass', namespaced: false },
    'networkpolicy': { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', namespaced: true },
    'storageclass': { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', namespaced: false },
    'role': { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', namespaced: true },
    'rolebinding': { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', namespaced: true },
    'clusterrole': { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole', namespaced: false },
    'clusterrolebinding': { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRoleBinding', namespaced: false },
    'horizontalpodautoscaler': { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', namespaced: true },
    'poddisruptionbudget': { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', namespaced: true },
    'priorityclass': { apiVersion: 'scheduling.k8s.io/v1', kind: 'PriorityClass', namespaced: false },
    'runtimeclass': { apiVersion: 'node.k8s.io/v1', kind: 'RuntimeClass', namespaced: false },
    'mutatingwebhookconfiguration': { apiVersion: 'admissionregistration.k8s.io/v1', kind: 'MutatingWebhookConfiguration', namespaced: false },
    'validatingwebhookconfiguration': { apiVersion: 'admissionregistration.k8s.io/v1', kind: 'ValidatingWebhookConfiguration', namespaced: false },
    'endpointslice': { apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', namespaced: true },
    'endpoint': { apiVersion: 'v1', kind: 'Endpoints', namespaced: true },
};

export const getDeploymentStatus = (dep: any) => {
    const conditions = dep.status?.conditions || [];

    // Check for specific failure states first
    const replicaFailure = conditions.find((c: any) => c.type === 'ReplicaFailure' && c.status === 'True');
    if (replicaFailure) return { status: 'Failed', color: 'red' };

    const progressing = conditions.find((c: any) => c.type === 'Progressing');
    if (progressing && progressing.status === 'False') return { status: 'Stalled', color: 'red' };

    // If it's progressing but not yet available (rolling update in progress)
    if (progressing && progressing.status === 'True' && dep.status?.updatedReplicas < dep.spec?.replicas) {
        return { status: 'Updating', color: 'blue' };
    }

    // Available check
    const available = conditions.find((c: any) => c.type === 'Available' && c.status === 'True');
    if (available) return { status: 'Active', color: 'green' };
    return { status: 'Pending', color: 'yellow' };
};

export const hasResourceChanged = (prev: any[], current: any[]): boolean => {
    if (prev.length !== current.length) return true;
    // Check if any item has a different resourceVersion or is a different item
    // Assuming order might change or not? Usually API returns consistent order or we sort?
    // But faster to just map by UID or Name.
    // Let's assume standard simple check first:
    // If we just check resourceVersion equality for all items.

    // Better: create a map of prev items
    const prevMap = new Map(prev.map(i => [i.metadata?.uid || i.metadata?.name, i.metadata?.resourceVersion]));

    for (const item of current) {
        const id = item.metadata?.uid || item.metadata?.name;
        const ver = item.metadata?.resourceVersion;
        if (!prevMap.has(id)) return true; // New item
        if (prevMap.get(id) !== ver) return true; // Changed item
    }

    return false;
};


export function resolveResourceMeta(resource: any, resourceType: string): {
    apiVersion: string;
    kind: string;
    name: string;
    namespace: string | undefined;
} {
    const name = resource.metadata?.name ?? resource.name;
    const namespace = resource.metadata?.namespace ?? resource.namespace ?? undefined;

    const mapped = RESOURCE_TYPE_MAP[resourceType];
    const apiVersion = resource.apiVersion || mapped?.apiVersion;
    const kind = resource.kind || mapped?.kind;

    if (!apiVersion || !kind) {
        throw new Error(
            `Unable to resolve apiVersion or kind for resource type "${resourceType}"`
        );
    }

    return { apiVersion, kind, name, namespace };
}

export function formatDeleteMessage(kind: string, name: string, namespace?: string): string {
    if (namespace) {
        return `Are you sure you want to delete ${kind} ${name} in namespace ${namespace}?`;
    }
    return `Are you sure you want to delete ${kind} ${name}? This is a cluster-scoped resource.`;
}
