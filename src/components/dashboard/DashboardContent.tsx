import React from 'react';
import { DeploymentsView } from './views/DeploymentsView';
import { PodsView } from './views/PodsView';
import { OverviewView } from './views/OverviewView';
import { NodesView } from './views/NodesView';
import { CertManagerView } from './views/CertManagerView';
import { AwsView } from './views/AwsView';
import { GenericResourceView } from './views/GenericResourceView';
import { TimeAgo } from '../shared/TimeAgo';

// Resource type union matching Dashboard's handleResourceClick
type ResourceType = 'deployment' | 'pod' | 'replicaset' | 'service' | 'clusterrole' | 'clusterrolebinding' | 'rolebinding' | 'serviceaccount' | 'role' | 'node' | 'crd-definition' | 'custom-resource' | 'daemonset' | 'statefulset' | 'job' | 'cronjob' | 'endpointslice' | 'endpoint' | 'ingress' | 'ingressclass' | 'networkpolicy' | 'persistentvolumeclaim' | 'persistentvolume' | 'storageclass' | 'configmap' | 'secret' | 'horizontalpodautoscaler' | 'poddisruptionbudget' | 'mutatingwebhookconfiguration' | 'validatingwebhookconfiguration' | 'priorityclass' | 'runtimeclass' | 'namespace' | 'other';

interface DashboardContentProps {
    // View state
    activeView: string;
    isCrdView: boolean;
    currentCrdKind: string;

    // Resource data
    pods: any[];
    deployments: any[];
    replicaSets: any[];
    services: any[];
    nodes: any[];
    events: any[];
    namespacesList: any[];
    crdDefinitions: any[];
    customObjects: any[];
    daemonSets: any[];
    statefulSets: any[];
    jobs: any[];
    cronJobs: any[];
    configMaps: any[];
    secrets: any[];
    pvcs: any[];
    pvs: any[];
    storageClasses: any[];
    ingresses: any[];
    ingressClasses: any[];
    endpointSlices: any[];
    endpoints: any[];
    networkPolicies: any[];
    serviceAccounts: any[];
    roles: any[];
    roleBindings: any[];
    clusterRoles: any[];
    clusterRoleBindings: any[];
    horizontalPodAutoscalers: any[];
    podDisruptionBudgets: any[];
    mutatingWebhookConfigurations: any[];
    validatingWebhookConfigurations: any[];
    priorityClasses: any[];
    runtimeClasses: any[];
    podMetrics: Record<string, { cpu: string; memory: string }>;

    // UI state
    loading: boolean;
    podViewMode: 'list' | 'visual';
    sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
    searchQuery: string;

    // Cluster info
    clusterName: string;
    selectedNamespaces: string[];

    // Callbacks
    onSort: (key: string) => void;
    onResourceClick: (resource: any, type: ResourceType) => void;
    onNavigate?: (view: string) => void;
    getSortedData: (data: any[]) => any[];
}

/**
 * Dashboard content component that renders all views
 * Memoized to prevent unnecessary re-renders
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const DashboardContent = React.memo<DashboardContentProps>(({
    activeView,
    isCrdView,
    currentCrdKind,
    pods,
    deployments,
    replicaSets,
    services,
    nodes,
    events,
    namespacesList,
    crdDefinitions,
    customObjects,
    daemonSets,
    statefulSets,
    jobs,
    cronJobs,
    configMaps,
    secrets,
    pvcs: _pvcs,
    pvs: _pvs,
    storageClasses: _storageClasses,
    ingresses: _ingresses,
    ingressClasses: _ingressClasses,
    endpointSlices: _endpointSlices,
    endpoints: _endpoints,
    networkPolicies: _networkPolicies,
    serviceAccounts: _serviceAccounts,
    roles: _roles,
    roleBindings: _roleBindings,
    clusterRoles: _clusterRoles,
    clusterRoleBindings: _clusterRoleBindings,
    horizontalPodAutoscalers: _horizontalPodAutoscalers,
    podDisruptionBudgets: _podDisruptionBudgets,
    mutatingWebhookConfigurations: _mutatingWebhookConfigurations,
    validatingWebhookConfigurations: _validatingWebhookConfigurations,
    priorityClasses: _priorityClasses,
    runtimeClasses: _runtimeClasses,
    podMetrics,
    loading,
    podViewMode,
    sortConfig,
    searchQuery,
    clusterName,
    selectedNamespaces,
    onSort,
    onResourceClick,
    onNavigate,
    getSortedData,
}) => {
    // Overview View
    if (activeView === 'overview') {
        return (
            <div className="mb-8">
                <OverviewView
                    pods={pods}
                    deployments={deployments}
                    events={events}
                    isLoading={loading}
                    onNavigate={onNavigate}
                    onSwitchToVisualPods={() => {/* handled by parent */ }}
                />
            </div>
        );
    }

    // Nodes View
    if (activeView === 'nodes') {
        return (
            <NodesView
                nodes={nodes}
                onRowClick={(node: any) => onResourceClick(node, 'node')}
                searchQuery={searchQuery}
            />
        );
    }

    // AWS View
    if (activeView === 'aws') {
        return <AwsView clusterName={clusterName} />;
    }

    // Backgrounds View (empty)
    if (activeView === 'backgrounds') {
        return null;
    }

    // Namespaces View
    if (activeView === 'namespaces') {
        return (
            <GenericResourceView
                viewKey="namespaces"
                description="Virtual clusters backed by the same physical cluster."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Status', dataKey: 'status', width: 100, flexGrow: 0, cellRenderer: (s) => <span className={s === 'Active' ? 'text-green-400' : 'text-gray-400'}>{s}</span> },
                    { label: 'Labels', dataKey: 'labels', flexGrow: 1, cellRenderer: (labels) => labels ? Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(', ') : '-' },
                    { label: 'Annotations', dataKey: 'annotations', flexGrow: 1, cellRenderer: (anns) => anns ? Object.keys(anns).length + ' annotations' : '-' },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={namespacesList}
                onRowClick={(ns: any) => onResourceClick({ ...ns, type: 'namespace' }, 'namespace' as any)}
                searchQuery={searchQuery}
            />
        );
    }

    // Certificates View
    if (activeView === 'certificates') {
        return <CertManagerView clusterName={clusterName} searchQuery={searchQuery} />;
    }

    // CRD View
    if (isCrdView) {
        return (
            <GenericResourceView
                viewKey={`crd-${currentCrdKind}`}
                description={currentCrdKind || 'Custom Resources'}
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns || '-'}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={customObjects}
                onRowClick={(obj: any) => onResourceClick(obj, 'custom-resource')}
                searchQuery={searchQuery}
            />
        );
    }

    // CRD Definitions View
    if (activeView === 'crd-definitions') {
        return (
            <GenericResourceView
                viewKey="crd-definitions"
                description="Definitions of Custom Resources installed in the cluster."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Group', dataKey: 'group', flexGrow: 1, cellRenderer: (g) => <span className="text-blue-400">{g}</span> },
                    { label: 'Kind', dataKey: 'kind', flexGrow: 1, cellRenderer: (k) => <span className="text-gray-300">{k}</span> },
                    { label: 'Scope', dataKey: 'scope', width: 100, flexGrow: 0, cellRenderer: (s) => <span className="text-gray-400">{s}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={crdDefinitions}
                onRowClick={(crd: any) => onResourceClick(crd, 'crd-definition')}
                searchQuery={searchQuery}
            />
        );
    }

    // Deployments View
    if (activeView === 'deployments') {
        return (
            <DeploymentsView
                deployments={deployments}
                isLoading={loading}
                clusterName={clusterName}
                selectedNamespaces={selectedNamespaces}
                searchQuery={searchQuery}
                onRowClick={(dep) => onResourceClick(dep, 'deployment')}
            />
        );
    }

    // Pods View
    if (activeView === 'pods') {
        return (
            <PodsView
                viewMode={podViewMode}
                pods={pods}
                sortedPods={getSortedData(pods)}
                nodes={nodes}
                sortConfig={sortConfig}
                onSort={onSort}
                onRowClick={(pod: any) => onResourceClick(pod, 'pod')}
                searchQuery={searchQuery}
                isLoading={loading}
                podMetrics={podMetrics}
            />
        );
    }

    // ReplicaSets View
    if (activeView === 'replicasets') {
        return (
            <GenericResourceView
                viewKey="replicasets"
                description="Ensures a specified number of pod replicas are running at any given time."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Desired', dataKey: 'desired', width: 80, flexGrow: 0, cellRenderer: (d) => <span className="text-gray-400">{d}</span> },
                    { label: 'Current', dataKey: 'current', width: 80, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                    { label: 'Ready', dataKey: 'ready', width: 80, flexGrow: 0, cellRenderer: (r) => <span className="text-gray-400">{r}</span> }
                ]}
                data={replicaSets}
                onRowClick={(rs: any) => onResourceClick(rs, 'replicaset')}
                searchQuery={searchQuery}
            />
        );
    }

    // Services View
    if (activeView === 'services') {
        return (
            <GenericResourceView
                viewKey="services"
                description="Network services for your application components."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Type', dataKey: 'type', width: 120, flexGrow: 0, cellRenderer: (t) => <span className="text-gray-400">{t}</span> },
                    { label: 'Cluster IP', dataKey: 'clusterIP', width: 120, flexGrow: 0, cellRenderer: (ip) => <span className="text-gray-400 font-mono text-xs">{ip}</span> },
                    { label: 'Ports', dataKey: 'ports', flexGrow: 1, cellRenderer: (p) => <span className="text-gray-400 font-mono text-xs">{p}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400">{new Date(age).toLocaleDateString()}</span> }
                ]}
                data={services}
                onRowClick={(svc: any) => onResourceClick(svc, 'service')}
                searchQuery={searchQuery}
            />
        );
    }

    // DaemonSets View
    if (activeView === 'daemonsets') {
        return (
            <GenericResourceView
                viewKey="daemonsets"
                description="Ensures all (or some) nodes run a copy of a pod."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Desired', dataKey: 'desired', width: 80, flexGrow: 0, cellRenderer: (d) => <span className="text-gray-400">{d}</span> },
                    { label: 'Current', dataKey: 'current', width: 80, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                    { label: 'Ready', dataKey: 'ready', width: 80, flexGrow: 0, cellRenderer: (r) => <span className="text-gray-400">{r}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={daemonSets}
                onRowClick={(ds: any) => onResourceClick(ds, 'daemonset')}
                searchQuery={searchQuery}
            />
        );
    }

    // StatefulSets View
    if (activeView === 'statefulsets') {
        return (
            <GenericResourceView
                viewKey="statefulsets"
                description="Manages stateful applications with persistent storage."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Desired', dataKey: 'desired', width: 80, flexGrow: 0, cellRenderer: (d) => <span className="text-gray-400">{d}</span> },
                    { label: 'Current', dataKey: 'current', width: 80, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                    { label: 'Ready', dataKey: 'ready', width: 80, flexGrow: 0, cellRenderer: (r) => <span className="text-gray-400">{r}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={statefulSets}
                onRowClick={(ss: any) => onResourceClick(ss, 'statefulset')}
                searchQuery={searchQuery}
            />
        );
    }

    // Jobs View
    if (activeView === 'jobs') {
        return (
            <GenericResourceView
                viewKey="jobs"
                description="Creates one or more pods and ensures a specified number complete successfully."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Completions', dataKey: 'completions', width: 100, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                    { label: 'Duration', dataKey: 'duration', width: 100, flexGrow: 0, cellRenderer: (d) => <span className="text-gray-400">{d}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={jobs}
                onRowClick={(job: any) => onResourceClick(job, 'job')}
                searchQuery={searchQuery}
            />
        );
    }

    // CronJobs View
    if (activeView === 'cronjobs') {
        return (
            <GenericResourceView
                viewKey="cronjobs"
                description="Creates jobs on a repeating schedule."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Schedule', dataKey: 'schedule', flexGrow: 1, cellRenderer: (s) => <span className="text-gray-400 font-mono text-xs">{s}</span> },
                    { label: 'Suspend', dataKey: 'suspend', width: 80, flexGrow: 0, cellRenderer: (s) => <span className="text-gray-400">{s ? 'Yes' : 'No'}</span> },
                    { label: 'Active', dataKey: 'active', width: 80, flexGrow: 0, cellRenderer: (a) => <span className="text-gray-400">{a}</span> },
                    { label: 'Last Schedule', dataKey: 'lastSchedule', width: 120, flexGrow: 0, cellRenderer: (ls) => <span className="text-gray-400">{ls ? <TimeAgo timestamp={ls} /> : '-'}</span> }
                ]}
                data={cronJobs}
                onRowClick={(cj: any) => onResourceClick(cj, 'cronjob')}
                searchQuery={searchQuery}
            />
        );
    }

    // ConfigMaps View
    if (activeView === 'configmaps') {
        return (
            <GenericResourceView
                viewKey="configmaps"
                description="Store non-confidential configuration data in key-value pairs."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Data', dataKey: 'data', width: 80, flexGrow: 0, cellRenderer: (d) => <span className="text-gray-400">{d} keys</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={configMaps}
                onRowClick={(cm: any) => onResourceClick(cm, 'configmap')}
                searchQuery={searchQuery}
            />
        );
    }

    // Secrets View
    if (activeView === 'secrets') {
        return (
            <GenericResourceView
                viewKey="secrets"
                description="Store sensitive information such as passwords, tokens, or keys."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Type', dataKey: 'type', flexGrow: 1, cellRenderer: (t) => <span className="text-gray-400 text-xs">{t}</span> },
                    { label: 'Data', dataKey: 'data', width: 80, flexGrow: 0, cellRenderer: (d) => <span className="text-gray-400">{d} keys</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={secrets}
                onRowClick={(secret: any) => onResourceClick(secret, 'secret')}
                searchQuery={searchQuery}
            />
        );
    }

    // PVCs View
    if (activeView === 'persistentvolumeclaims') {
        return (
            <GenericResourceView
                viewKey="persistentvolumeclaims"
                description="Persistent Volume Claims for storage requests."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Status', dataKey: 'status', width: 100, flexGrow: 0, cellRenderer: (s) => <span className="text-gray-400">{s}</span> },
                    { label: 'Volume', dataKey: 'volume', flexGrow: 1, cellRenderer: (v) => <span className="text-gray-400">{v || '-'}</span> },
                    { label: 'Capacity', dataKey: 'capacity', width: 100, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_pvcs}
                onRowClick={(pvc: any) => onResourceClick(pvc, 'persistentvolumeclaim')}
                searchQuery={searchQuery}
            />
        );
    }

    // PVs View
    if (activeView === 'persistentvolumes') {
        return (
            <GenericResourceView
                viewKey="persistentvolumes"
                description="Persistent Volumes available in the cluster."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Capacity', dataKey: 'capacity', width: 100, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                    { label: 'Access Modes', dataKey: 'accessModes', flexGrow: 1, cellRenderer: (am) => <span className="text-gray-400 text-xs">{am}</span> },
                    { label: 'Reclaim Policy', dataKey: 'reclaimPolicy', width: 120, flexGrow: 0, cellRenderer: (rp) => <span className="text-gray-400">{rp}</span> },
                    { label: 'Status', dataKey: 'status', width: 100, flexGrow: 0, cellRenderer: (s) => <span className="text-gray-400">{s}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_pvs}
                onRowClick={(pv: any) => onResourceClick(pv, 'persistentvolume')}
                searchQuery={searchQuery}
            />
        );
    }

    // Storage Classes View
    if (activeView === 'storageclasses') {
        return (
            <GenericResourceView
                viewKey="storageclasses"
                description="Storage classes for dynamic volume provisioning."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Provisioner', dataKey: 'provisioner', flexGrow: 2, cellRenderer: (p) => <span className="text-gray-400 text-xs">{p}</span> },
                    { label: 'Reclaim Policy', dataKey: 'reclaimPolicy', width: 120, flexGrow: 0, cellRenderer: (rp) => <span className="text-gray-400">{rp}</span> },
                    { label: 'Volume Binding Mode', dataKey: 'volumeBindingMode', width: 150, flexGrow: 0, cellRenderer: (vbm) => <span className="text-gray-400">{vbm}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_storageClasses}
                onRowClick={(sc: any) => onResourceClick(sc, 'storageclass')}
                searchQuery={searchQuery}
            />
        );
    }

    // Ingresses View
    if (activeView === 'ingresses') {
        return (
            <GenericResourceView
                viewKey="ingresses"
                description="Manage external access to services in the cluster."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Class', dataKey: 'class', width: 120, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c || '-'}</span> },
                    { label: 'Hosts', dataKey: 'hosts', flexGrow: 2, cellRenderer: (h) => <span className="text-gray-400 text-xs">{h}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_ingresses}
                onRowClick={(ing: any) => onResourceClick(ing, 'ingress')}
                searchQuery={searchQuery}
            />
        );
    }

    // Ingress Classes View
    if (activeView === 'ingressclasses') {
        return (
            <GenericResourceView
                viewKey="ingressclasses"
                description="Ingress controller implementations."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Controller', dataKey: 'controller', flexGrow: 2, cellRenderer: (c) => <span className="text-gray-400 text-xs">{c}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_ingressClasses}
                onRowClick={(ic: any) => onResourceClick(ic, 'ingressclass')}
                searchQuery={searchQuery}
            />
        );
    }

    // Endpoint Slices View
    if (activeView === 'endpointslices') {
        return (
            <GenericResourceView
                viewKey="endpointslices"
                description="Scalable network endpoint tracking."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Address Type', dataKey: 'addressType', width: 120, flexGrow: 0, cellRenderer: (at) => <span className="text-gray-400">{at}</span> },
                    { label: 'Endpoints', dataKey: 'endpoints', width: 100, flexGrow: 0, cellRenderer: (e) => <span className="text-gray-400">{e}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_endpointSlices}
                onRowClick={(es: any) => onResourceClick(es, 'endpointslice')}
                searchQuery={searchQuery}
            />
        );
    }

    // Endpoints View
    if (activeView === 'endpoints') {
        return (
            <GenericResourceView
                viewKey="endpoints"
                description="Network endpoints for services."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Endpoints', dataKey: 'endpoints', flexGrow: 2, cellRenderer: (e) => <span className="text-gray-400 text-xs">{e}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_endpoints}
                onRowClick={(ep: any) => onResourceClick(ep, 'endpoint')}
                searchQuery={searchQuery}
            />
        );
    }

    // Network Policies View
    if (activeView === 'networkpolicies') {
        return (
            <GenericResourceView
                viewKey="networkpolicies"
                description="Network traffic rules for pods."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Pod Selector', dataKey: 'podSelector', flexGrow: 2, cellRenderer: (ps) => <span className="text-gray-400 text-xs">{ps}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_networkPolicies}
                onRowClick={(np: any) => onResourceClick(np, 'networkpolicy')}
                searchQuery={searchQuery}
            />
        );
    }

    // Service Accounts View
    if (activeView === 'serviceaccounts') {
        return (
            <GenericResourceView
                viewKey="serviceaccounts"
                description="Identities for processes running in pods."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Secrets', dataKey: 'secrets', width: 100, flexGrow: 0, cellRenderer: (s) => <span className="text-gray-400">{s}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_serviceAccounts}
                onRowClick={(sa: any) => onResourceClick(sa, 'serviceaccount')}
                searchQuery={searchQuery}
            />
        );
    }

    // Roles View
    if (activeView === 'roles') {
        return (
            <GenericResourceView
                viewKey="roles"
                description="Namespace-scoped permissions."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_roles}
                onRowClick={(role: any) => onResourceClick(role, 'role')}
                searchQuery={searchQuery}
            />
        );
    }

    // Role Bindings View
    if (activeView === 'rolebindings') {
        return (
            <GenericResourceView
                viewKey="rolebindings"
                description="Bind roles to users, groups, or service accounts."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Role', dataKey: 'role', flexGrow: 1, cellRenderer: (r) => <span className="text-gray-400">{r}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_roleBindings}
                onRowClick={(rb: any) => onResourceClick(rb, 'rolebinding')}
                searchQuery={searchQuery}
            />
        );
    }

    // Cluster Roles View
    if (activeView === 'clusterroles') {
        return (
            <GenericResourceView
                viewKey="clusterroles"
                description="Cluster-wide permissions."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_clusterRoles}
                onRowClick={(cr: any) => onResourceClick(cr, 'clusterrole')}
                searchQuery={searchQuery}
            />
        );
    }

    // Cluster Role Bindings View
    if (activeView === 'clusterrolebindings') {
        return (
            <GenericResourceView
                viewKey="clusterrolebindings"
                description="Bind cluster roles to users, groups, or service accounts."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Role', dataKey: 'role', flexGrow: 1, cellRenderer: (r) => <span className="text-gray-400">{r}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_clusterRoleBindings}
                onRowClick={(crb: any) => onResourceClick(crb, 'clusterrolebinding')}
                searchQuery={searchQuery}
            />
        );
    }

    // HPAs View
    if (activeView === 'horizontalpodautoscalers') {
        return (
            <GenericResourceView
                viewKey="horizontalpodautoscalers"
                description="Horizontal Pod Autoscalers for automatic scaling."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Reference', dataKey: 'reference', flexGrow: 1, cellRenderer: (r) => <span className="text-gray-400 text-xs">{r}</span> },
                    { label: 'Min/Max', dataKey: 'minMax', width: 100, flexGrow: 0, cellRenderer: (mm) => <span className="text-gray-400">{mm}</span> },
                    { label: 'Replicas', dataKey: 'replicas', width: 80, flexGrow: 0, cellRenderer: (r) => <span className="text-gray-400">{r}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_horizontalPodAutoscalers}
                onRowClick={(hpa: any) => onResourceClick(hpa, 'horizontalpodautoscaler')}
                searchQuery={searchQuery}
            />
        );
    }

    // PDBs View
    if (activeView === 'poddisruptionbudgets') {
        return (
            <GenericResourceView
                viewKey="poddisruptionbudgets"
                description="Pod Disruption Budgets for availability during disruptions."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                    { label: 'Min Available', dataKey: 'minAvailable', width: 120, flexGrow: 0, cellRenderer: (ma) => <span className="text-gray-400">{ma || '-'}</span> },
                    { label: 'Max Unavailable', dataKey: 'maxUnavailable', width: 120, flexGrow: 0, cellRenderer: (mu) => <span className="text-gray-400">{mu || '-'}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_podDisruptionBudgets}
                onRowClick={(pdb: any) => onResourceClick(pdb, 'poddisruptionbudget')}
                searchQuery={searchQuery}
            />
        );
    }

    // Mutating Webhooks View
    if (activeView === 'mutatingwebhookconfigurations') {
        return (
            <GenericResourceView
                viewKey="mutatingwebhookconfigurations"
                description="Mutating admission webhooks."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Webhooks', dataKey: 'webhooks', width: 100, flexGrow: 0, cellRenderer: (w) => <span className="text-gray-400">{w}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_mutatingWebhookConfigurations}
                onRowClick={(mwc: any) => onResourceClick(mwc, 'mutatingwebhookconfiguration')}
                searchQuery={searchQuery}
            />
        );
    }

    // Validating Webhooks View
    if (activeView === 'validatingwebhookconfigurations') {
        return (
            <GenericResourceView
                viewKey="validatingwebhookconfigurations"
                description="Validating admission webhooks."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Webhooks', dataKey: 'webhooks', width: 100, flexGrow: 0, cellRenderer: (w) => <span className="text-gray-400">{w}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_validatingWebhookConfigurations}
                onRowClick={(vwc: any) => onResourceClick(vwc, 'validatingwebhookconfiguration')}
                searchQuery={searchQuery}
            />
        );
    }

    // Priority Classes View
    if (activeView === 'priorityclasses') {
        return (
            <GenericResourceView
                viewKey="priorityclasses"
                description="Priority classes for pod scheduling."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Value', dataKey: 'value', width: 100, flexGrow: 0, cellRenderer: (v) => <span className="text-gray-400">{v}</span> },
                    { label: 'Global Default', dataKey: 'globalDefault', width: 120, flexGrow: 0, cellRenderer: (gd) => <span className="text-gray-400">{gd ? 'Yes' : 'No'}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_priorityClasses}
                onRowClick={(pc: any) => onResourceClick(pc, 'priorityclass')}
                searchQuery={searchQuery}
            />
        );
    }

    // Runtime Classes View
    if (activeView === 'runtimeclasses') {
        return (
            <GenericResourceView
                viewKey="runtimeclasses"
                description="Runtime classes for container runtime selection."
                columns={[
                    { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                    { label: 'Handler', dataKey: 'handler', flexGrow: 1, cellRenderer: (h) => <span className="text-gray-400">{h}</span> },
                    { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                ]}
                data={_runtimeClasses}
                onRowClick={(rc: any) => onResourceClick(rc, 'runtimeclass')}
                searchQuery={searchQuery}
            />
        );
    }

    // Continue with remaining views in next part due to length...
    // For now, return null for unhandled views
    return null;
});

DashboardContent.displayName = 'DashboardContent';
