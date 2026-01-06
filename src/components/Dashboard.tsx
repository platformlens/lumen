import React, { useState, useEffect } from 'react';
import { DeploymentsView } from './dashboard/views/DeploymentsView';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Activity,
    Layers,
    Network,
    PenTool,
    Square,
    Trash,
    Search,
    RotateCcw
} from 'lucide-react';

import { ErrorBoundary } from './shared/ErrorBoundary';
import { TimeAgo } from './shared/TimeAgo';
import { NamespaceSelector } from './dashboard/NamespaceSelector';
import { Drawer } from './shared/Drawer';
import { DrawerDetailsRenderer } from './dashboard/DrawerDetailsRenderer';
import { GenericResourceView } from './dashboard/views/GenericResourceView';
import { PodsView } from './dashboard/views/PodsView';
import { OverviewView } from './dashboard/views/OverviewView';
import { ResourceTopology } from './resources/visualizers/ResourceTopology';
import { ScaleModal } from './shared/ScaleModal';
import { NodesView } from './dashboard/views/NodesView';
import { CertManagerView } from './dashboard/views/CertManagerView';

interface DashboardProps {
    clusterName: string;
    activeView: string;
    onOpenLogs: (pod: any, containerName: string) => void;
    onNavigate?: (view: string) => void;
    onOpenYaml?: (deployment: any) => void;
    onExplain?: (resource: any) => void;
}


export const Dashboard: React.FC<DashboardProps> = ({ clusterName, activeView, onOpenLogs, onNavigate, onOpenYaml, onExplain }) => {
    const [namespaces, setNamespaces] = useState<string[]>([]);
    const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>(['all']);

    const [deployments, setDeployments] = useState<any[]>([]);
    const [pods, setPods] = useState<any[]>([]);
    const [replicaSets, setReplicaSets] = useState<any[]>([]);
    const [services, setServices] = useState<any[]>([]);
    const [clusterRoleBindings, setClusterRoleBindings] = useState<any[]>([]);
    const [clusterRoles, setClusterRoles] = useState<any[]>([]);
    const [roleBindings, setRoleBindings] = useState<any[]>([]);
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [roles, setRoles] = useState<any[]>([]);
    const [serviceAccounts, setServiceAccounts] = useState<any[]>([]);
    const [daemonSets, setDaemonSets] = useState<any[]>([]);
    const [statefulSets, setStatefulSets] = useState<any[]>([]);
    const [jobs, setJobs] = useState<any[]>([]);
    const [cronJobs, setCronJobs] = useState<any[]>([]);

    // Network State
    const [endpointSlices, setEndpointSlices] = useState<any[]>([]);
    const [endpoints, setEndpoints] = useState<any[]>([]);
    const [ingresses, setIngresses] = useState<any[]>([]);
    const [ingressClasses, setIngressClasses] = useState<any[]>([]);
    const [networkPolicies, setNetworkPolicies] = useState<any[]>([]);

    // Storage State
    const [pvcs, setPvcs] = useState<any[]>([]);
    const [pvs, setPvs] = useState<any[]>([]);
    const [storageClasses, setStorageClasses] = useState<any[]>([]);

    // Config State
    const [configMaps, setConfigMaps] = useState<any[]>([]);
    const [secrets, setSecrets] = useState<any[]>([]);
    const [horizontalPodAutoscalers, setHorizontalPodAutoscalers] = useState<any[]>([]);
    const [podDisruptionBudgets, setPodDisruptionBudgets] = useState<any[]>([]);
    const [mutatingWebhookConfigurations, setMutatingWebhookConfigurations] = useState<any[]>([]);
    const [validatingWebhookConfigurations, setValidatingWebhookConfigurations] = useState<any[]>([]);
    const [priorityClasses, setPriorityClasses] = useState<any[]>([]);
    const [runtimeClasses, setRuntimeClasses] = useState<any[]>([]);

    const [nodes, setNodes] = useState<any[]>([]);
    const [customObjects, setCustomObjects] = useState<any[]>([]);
    const [currentCrdKind, setCurrentCrdKind] = useState<string>('');
    const [crdDefinitions, setCrdDefinitions] = useState<any[]>([]);
    const [namespacesList, setNamespacesList] = useState<any[]>([]);

    // Handle CRD view parsing
    const isCrdView = activeView.startsWith('crd/');
    const crdParams = isCrdView ? activeView.split('/') : []; // ['crd', group, version, plural]

    // Selection State
    const [selectedResource, setSelectedResource] = useState<any>(null);
    const [detailedResource, setDetailedResource] = useState<any>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    // AI State

    const [isScaleModalOpen, setIsScaleModalOpen] = useState(false);
    const [drawerTab, setDrawerTab] = useState<'details' | 'topology'>('details');
    const [podViewMode, setPodViewMode] = useState<'list' | 'visual'>('list');

    // Sorting State
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Clear search when active view changes
    useEffect(() => {
        setSearchQuery('');
    }, [activeView]);


    const handleOpenLogs = (pod: any, containerName: string) => {
        // Pass up to parent
        onOpenLogs(pod, containerName);
        setIsDrawerOpen(false);
    };



    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getSortedData = (data: any[]) => {
        if (!sortConfig) return data;

        return [...data].sort((a, b) => {
            if (sortConfig.key === 'age') {
                // Age is timestamp string
                const dateA = new Date(a.age).getTime();
                const dateB = new Date(b.age).getTime();
                return sortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA;
            }
            if (sortConfig.key === 'restarts') {
                return sortConfig.direction === 'asc' ? a.restarts - b.restarts : b.restarts - a.restarts;
            }

            if (sortConfig.key === 'status') {
                // Determine health: true if available == replicas
                // We want to sort primarily by health (healthy vs not)
                // And maybe secondarily by available replicas

                // For deployments/replicasets
                if ('availableReplicas' in a) {
                    const isHealthyA = (a.availableReplicas === a.replicas && a.replicas > 0);
                    const isHealthyB = (b.availableReplicas === b.replicas && b.replicas > 0);

                    if (isHealthyA === isHealthyB) {
                        // Tie-break with available replicas
                        return sortConfig.direction === 'asc'
                            ? (a.availableReplicas || 0) - (b.availableReplicas || 0)
                            : (b.availableReplicas || 0) - (a.availableReplicas || 0);
                    }

                    // Healthy (true) > Unhealthy (false)
                    // ASC: false, true
                    // DESC: true, false
                    return sortConfig.direction === 'asc'
                        ? (isHealthyA ? 1 : -1)
                        : (isHealthyA ? -1 : 1);
                }
            }

            // Default string comparison
            const valA = a[sortConfig.key]?.toString().toLowerCase() || '';
            const valB = b[sortConfig.key]?.toString().toLowerCase() || '';

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    };








    // Load Namespaces
    useEffect(() => {
        // Explicitly wipe state on cluster change to prevent data leaks from previous cluster
        setPods([]);
        setDeployments([]);
        setReplicaSets([]);
        setServices([]);
        setEvents([]);
        setEndpointSlices([]);
        setEndpoints([]);
        setIngresses([]);
        console.log('[Dashboard] State wiped for new cluster:', clusterName);

        window.k8s.getNamespaces(clusterName).then(setNamespaces).catch(console.error);

        if (activeView === 'namespaces') {
            setLoading(true);
            window.k8s.getNamespacesDetails(clusterName)
                .then(res => {
                    setNamespacesList(res);
                    setLoading(false);
                })
                .catch(err => {
                    console.error("Failed to load namespaces", err);
                    setLoading(false);
                });
        }
    }, [clusterName, activeView]);

    // Watcher Effect
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        let batchTimeout: ReturnType<typeof setTimeout> | null = null;
        const pendingUpdates = new Map<string, { type: string; pod: any }>();

        // Only watch if we are in a view that needs pods
        const needsPods = activeView === 'overview' || activeView === 'pods';

        if (needsPods) {
            const nsToWatch = selectedNamespaces;

            // Start watching
            window.k8s.watchPods(clusterName, nsToWatch);

            const processBatch = () => {
                if (pendingUpdates.size === 0) {
                    batchTimeout = null;
                    return;
                }

                const updates = new Map(pendingUpdates);
                pendingUpdates.clear();
                batchTimeout = null;

                setPods(prev => {
                    // Use a Map for O(1) updates instead of O(N) array scans
                    // This reduces complexity from O(Updates * TotalPods) to O(TotalPods + Updates)
                    const podMap = new Map(prev.map(p => [`${p.namespace}/${p.name}`, p]));

                    updates.forEach(({ type, pod }) => {
                        const key = `${pod.namespace}/${pod.name}`;

                        // Strict Filtering: If not viewing 'all' namespaces, check if pod belongs to selected namespaces
                        const isSelected = selectedNamespaces.includes('all') || selectedNamespaces.includes(pod.namespace);

                        if (type === 'ADDED' || type === 'MODIFIED') {
                            if (isSelected) {
                                podMap.set(key, pod);
                            } else {
                                // Important: If a pod was previously in our list but now its namespace is not selected (unlikely for MODIFIED but possible if we switch views rapidly), remove it.
                                // Actually, if we are here, we might have received an event for a pod that we shouldn't show.
                                // If it is in the map, we should remove it? 
                                // No, if it's not selected, we just don't add it. But if it WAS there, we should delete it to be safe (e.g. namespace change? unlikely for pods).
                                // More common: we just don't add it.
                                // But if we have 'all' selected initially, then switch to 'default', watcher might still send events for 'kube-system' briefly.
                                // If podMap has it, we should remove it if it doesn't match current filter? 
                                // Yes, let's enforce filter on the whole map or just incoming? 
                                // Enforcing on incoming actions:
                                if (podMap.has(key)) podMap.delete(key);
                            }
                        } else if (type === 'DELETED') {
                            podMap.delete(key);
                        }
                    });

                    return Array.from(podMap.values());
                });
            };

            // Listen for changes
            cleanup = window.k8s.onPodChange((type, pod) => {
                // Buffer updates
                const key = `${pod.namespace}/${pod.name}`;
                pendingUpdates.set(key, { type, pod });

                // Debounce/Batch updates every 650ms
                if (!batchTimeout) {
                    batchTimeout = setTimeout(processBatch, 650);
                }
            });
        }

        return () => {
            // Only stop watching if we are LEAVING a needsPods state
            // Logic: dependencies change.
            if (cleanup) cleanup();
            if (batchTimeout) clearTimeout(batchTimeout);
            window.k8s.stopWatchPods();
        };
    }, [clusterName, selectedNamespaces, (activeView === 'overview' || activeView === 'pods')]);

    // Load Data based on View and Selection
    const loadResources = async () => {
        if (!clusterName) return;

        try {
            const needsPods = activeView === 'overview' || activeView === 'pods';
            // Only set loading if we don't have cached data for the critical path
            if (needsPods && pods.length === 0) {
                setLoading(true);
            } else if (!needsPods) {
                setLoading(true); // Other views always load fresh for now
            }

            const nsFilter = selectedNamespaces;
            const promises: Promise<any>[] = [];

            // Overview needs Pods (pie chart), Deployments (bar chart), and Events
            if (activeView === 'overview') {
                promises.push(window.k8s.getPods(clusterName, nsFilter).then(setPods));
                promises.push(window.k8s.getDeployments(clusterName, nsFilter).then(setDeployments));
                promises.push(window.k8s.getEvents(clusterName, nsFilter).then(setEvents));
            }

            if (activeView === 'deployments') {
                promises.push(window.k8s.getDeployments(clusterName, nsFilter).then(setDeployments));
            }

            // Individual Views
            if (activeView === 'nodes') {
                promises.push(window.k8s.getNodes(clusterName).then(setNodes));
            }

            if (activeView === 'pods') {
                promises.push(window.k8s.getPods(clusterName, nsFilter).then(setPods));
                promises.push(window.k8s.getNodes(clusterName).then(setNodes));
            }
            if (activeView === 'replicasets') {
                promises.push(window.k8s.getReplicaSets(clusterName, nsFilter).then(setReplicaSets));
            }
            if (activeView === 'services') {
                promises.push(window.k8s.getServices(clusterName, nsFilter).then(setServices));
            }
            if (activeView === 'clusterrolebindings') {
                promises.push(window.k8s.getClusterRoleBindings(clusterName).then(setClusterRoleBindings));
            }
            if (activeView === 'clusterroles') {
                promises.push(window.k8s.getClusterRoles(clusterName).then(setClusterRoles));
            }
            if (activeView === 'rolebindings') {
                promises.push(window.k8s.getRoleBindings(clusterName, nsFilter).then(setRoleBindings));
            }
            if (activeView === 'serviceaccounts') {
                promises.push(window.k8s.getServiceAccounts(clusterName, nsFilter).then(setServiceAccounts));
            }
            if (activeView === 'roles') {
                promises.push(window.k8s.getRoles(clusterName, nsFilter).then(setRoles));
            }
            if (activeView === 'daemonsets') {
                promises.push(window.k8s.getDaemonSets(clusterName, nsFilter).then(setDaemonSets));
            }
            if (activeView === 'statefulsets') {
                promises.push(window.k8s.getStatefulSets(clusterName, nsFilter).then(setStatefulSets));
            }
            if (activeView === 'jobs') {
                promises.push(window.k8s.getJobs(clusterName, nsFilter).then(setJobs));
            }
            if (activeView === 'cronjobs') {
                promises.push(window.k8s.getCronJobs(clusterName, nsFilter).then(setCronJobs));
            }

            // Handle CRD Definitions List
            if (activeView === 'crd-definitions') {
                promises.push(window.k8s.getCRDs(clusterName).then(setCrdDefinitions));
            }

            // Handle Dynamic CRD View
            if (isCrdView && crdParams.length >= 4) {
                const [_, group, version, plural] = crdParams;
                setCurrentCrdKind(plural); // Just use plural as title for now
                promises.push(window.k8s.getCustomObjects(clusterName, group, version, plural).then(setCustomObjects));
            }

            // Network
            if (activeView === 'endpointslices') {
                console.log('Fetching EndpointSlices...');
                window.k8s.getEndpointSlices(clusterName, nsFilter).then(data => { console.log('EndpointSlices:', data); setEndpointSlices(data); });
            }
            if (activeView === 'endpoints') {
                console.log('Fetching Endpoints...');
                window.k8s.getEndpoints(clusterName, nsFilter).then(data => { console.log('Endpoints:', data); setEndpoints(data); });
            }
            if (activeView === 'ingresses') {
                console.log('Fetching Ingresses...');
                window.k8s.getIngresses(clusterName, nsFilter).then(data => { console.log('Ingresses:', data); setIngresses(data); });
            }
            if (activeView === 'ingressclasses') {
                console.log('Fetching IngressClasses...');
                window.k8s.getIngressClasses(clusterName).then(data => { console.log('IngressClasses:', data); setIngressClasses(data); });
            }
            if (activeView === 'networkpolicies') {
                console.log('Fetching NetworkPolicies...');
                window.k8s.getNetworkPolicies(clusterName, nsFilter).then(data => { console.log('NetworkPolicies:', data); setNetworkPolicies(data); });
            }

            // Storage
            if (activeView === 'persistentvolumeclaims') {
                console.log('Fetching PVCs...');
                window.k8s.getPersistentVolumeClaims(clusterName, nsFilter).then(data => { console.log('PVCs:', data); setPvcs(data); });
            }
            if (activeView === 'persistentvolumes') {
                console.log('Fetching PVs...');
                window.k8s.getPersistentVolumes(clusterName).then(data => { console.log('PVs:', data); setPvs(data); });
            }
            if (activeView === 'storageclasses') {
                console.log('Fetching StorageClasses...');
                window.k8s.getStorageClasses(clusterName).then(data => { console.log('StorageClasses:', data); setStorageClasses(data); });
            }

            // Config
            if (activeView === 'configmaps') {
                window.k8s.getConfigMaps(clusterName, nsFilter).then(data => setConfigMaps(data));
            }
            if (activeView === 'secrets') {
                window.k8s.getSecrets(clusterName, nsFilter).then(data => setSecrets(data));
            }
            if (activeView === 'horizontalpodautoscalers') {
                window.k8s.getHorizontalPodAutoscalers(clusterName, nsFilter).then(data => setHorizontalPodAutoscalers(data));
            }
            if (activeView === 'poddisruptionbudgets') {
                window.k8s.getPodDisruptionBudgets(clusterName, nsFilter).then(data => setPodDisruptionBudgets(data));
            }
            if (activeView === 'mutatingwebhookconfigurations') {
                window.k8s.getMutatingWebhookConfigurations(clusterName).then(data => setMutatingWebhookConfigurations(data));
            }
            if (activeView === 'validatingwebhookconfigurations') {
                window.k8s.getValidatingWebhookConfigurations(clusterName).then(data => setValidatingWebhookConfigurations(data));
            }
            if (activeView === 'priorityclasses') {
                window.k8s.getPriorityClasses(clusterName).then(data => setPriorityClasses(data));
            }
            if (activeView === 'runtimeclasses') {
                window.k8s.getRuntimeClasses(clusterName).then(data => setRuntimeClasses(data));
            }

            await Promise.all(promises);

        } catch (e) {
            console.error("Failed to load resources", e);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadResources();
    }, [clusterName, selectedNamespaces, activeView]);

    const handleResourceClick = async (resource: any, type: 'deployment' | 'pod' | 'replicaset' | 'service' | 'clusterrole' | 'clusterrolebinding' | 'rolebinding' | 'serviceaccount' | 'role' | 'node' | 'crd-definition' | 'custom-resource' | 'daemonset' | 'statefulset' | 'job' | 'cronjob' | 'endpointslice' | 'endpoint' | 'ingress' | 'ingressclass' | 'networkpolicy' | 'persistentvolumeclaim' | 'persistentvolume' | 'storageclass' | 'configmap' | 'secret' | 'horizontalpodautoscaler' | 'poddisruptionbudget' | 'mutatingwebhookconfiguration' | 'validatingwebhookconfiguration' | 'priorityclass' | 'runtimeclass' | 'namespace' | 'other') => {
        setSelectedResource({ ...resource, type });
        setIsDrawerOpen(true);
        setDetailedResource(null); // Clear previous details while loading
        setDrawerTab('details'); // Reset tab on new selection

        // Only fetch details for types we have specific detail fetching logic for
        // Config resources will use generic details component
        if (['deployment', 'service', 'pod', 'replicaset', 'clusterrole', 'clusterrolebinding', 'rolebinding', 'serviceaccount', 'role', 'node', 'crd-definition', 'custom-resource', 'daemonset', 'statefulset', 'job', 'cronjob', 'endpointslice', 'endpoint', 'ingress', 'ingressclass', 'networkpolicy', 'persistentvolumeclaim', 'persistentvolume', 'storageclass', 'configmap', 'secret', 'horizontalpodautoscaler', 'poddisruptionbudget', 'mutatingwebhookconfiguration', 'validatingwebhookconfiguration', 'priorityclass', 'runtimeclass', 'namespace'].includes(type)) {
            try {
                if (type === 'deployment') {
                    const details = await window.k8s.getDeployment(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'namespace') {
                    setDetailedResource(resource);
                } else if (type === 'replicaset') {
                    const details = await window.k8s.getReplicaSet(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'daemonset') {
                    const details = await window.k8s.getDaemonSet(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'statefulset') {
                    const details = await window.k8s.getStatefulSet(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'job') {
                    const details = await window.k8s.getJob(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'cronjob') {
                    const details = await window.k8s.getCronJob(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'service') {
                    const details = await window.k8s.getService(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'pod') {
                    const details = await window.k8s.getPod(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'clusterrolebinding') {
                    const details = await window.k8s.getClusterRoleBinding(clusterName, resource.name);
                    setDetailedResource(details);
                } else if (type === 'clusterrole') {
                    const details = await window.k8s.getClusterRole(clusterName, resource.name);
                    setDetailedResource(details);
                } else if (type === 'rolebinding') {
                    // Check if namespace is present, it should be for rolebinding
                    const details = await window.k8s.getRoleBinding(clusterName, resource.namespace || 'default', resource.name);
                    setDetailedResource(details);
                } else if (type === 'serviceaccount') {
                    const details = await window.k8s.getServiceAccount(clusterName, resource.namespace || 'default', resource.name);
                    setDetailedResource(details);
                } else if (type === 'role') {
                    const details = await window.k8s.getRole(clusterName, resource.namespace || 'default', resource.name);
                    setDetailedResource(details);
                } else if (type === 'node') {
                    const details = await window.k8s.getNode(clusterName, resource.name);
                    setDetailedResource(details);
                } else if (type === 'crd-definition') {
                    console.log('Fetching CRD details for:', resource.name);
                    try {
                        const details = await window.k8s.getCRD(clusterName, resource.name);
                        console.log('CRD details received:', details);
                        if (details) {
                            setDetailedResource(details);
                        } else {
                            // Handle null/error case to stop spinner
                            setDetailedResource({ error: 'Failed to load details' });
                        }
                    } catch (e) {
                        console.error("Error fetching CRD", e);
                        setDetailedResource({ error: 'Failed to load details' });
                    }
                } else if (type === 'custom-resource') {
                    setDetailedResource(resource);
                } else if (type === 'endpointslice') {
                    const details = await window.k8s.getEndpointSlice(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'endpoint') {
                    const details = await window.k8s.getEndpoint(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'ingress') {
                    const details = await window.k8s.getIngress(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'ingressclass') {
                    const details = await window.k8s.getIngressClass(clusterName, resource.name);
                    setDetailedResource(details);
                } else if (type === 'networkpolicy') {
                    const details = await window.k8s.getNetworkPolicy(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'persistentvolumeclaim') {
                    const details = await window.k8s.getPersistentVolumeClaim(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'persistentvolume') {
                    const details = await window.k8s.getPersistentVolume(clusterName, resource.name);
                    setDetailedResource(details);
                } else if (type === 'storageclass') {
                    const details = await window.k8s.getStorageClass(clusterName, resource.name);
                    setDetailedResource(details);
                } else if (type === 'configmap') {
                    const details = await window.k8s.getConfigMap(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'secret') {
                    const details = await window.k8s.getSecret(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'horizontalpodautoscaler') {
                    const details = await window.k8s.getHorizontalPodAutoscaler(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'poddisruptionbudget') {
                    const details = await window.k8s.getPodDisruptionBudget(clusterName, resource.namespace, resource.name);
                    setDetailedResource(details);
                } else if (type === 'mutatingwebhookconfiguration') {
                    const details = await window.k8s.getMutatingWebhookConfiguration(clusterName, resource.name);
                    setDetailedResource(details);
                } else if (type === 'validatingwebhookconfiguration') {
                    const details = await window.k8s.getValidatingWebhookConfiguration(clusterName, resource.name);
                    setDetailedResource(details);
                } else if (type === 'priorityclass') {
                    const details = await window.k8s.getPriorityClass(clusterName, resource.name);
                    setDetailedResource(details);
                } else if (type === 'runtimeclass') {
                    const details = await window.k8s.getRuntimeClass(clusterName, resource.name);
                    setDetailedResource(details);
                }
                // For generic 'other' (CRDs), we might just show raw JSON or limited details if we don't have a specific parser
            } catch (err) {
                console.error("Error loading details", err);
            }
        }
    };

    const handleExplain = async (resource: any = null) => {
        const target = resource || detailedResource;
        if (!target) return;

        if (onExplain) {
            onExplain(target);
        }
    };



    const handleNavigate = async (kind: string, name: string) => {
        console.log('handleNavigate called with:', kind, name);
        // Find the resource
        let resource;
        const lowerKind = kind.toLowerCase();

        // Check if we have the resource in state
        if (lowerKind === 'replicaset') {
            resource = replicaSets.find(r => r.name === name && r.namespace === selectedResource?.namespace);
        } else if (lowerKind === 'deployment') {
            resource = deployments.find(d => d.metadata.name === name && d.metadata.namespace === selectedResource?.namespace);
        }

        // If not found in state, try to fetch it directly
        if (!resource) {
            console.log(`Resource ${kind}/${name} not found in state, fetching directly...`);
            try {
                const namespace = selectedResource?.namespace || 'default'; // Fallback or current context
                if (lowerKind === 'replicaset') {
                    const fetched = await window.k8s.getReplicaSet(clusterName, namespace, name);
                    if (fetched) {
                        // Normalize if needed or just use results. getReplicaSet returns the raw object or body?
                        // k8s.ts getReplicaSet returns body.
                        // We might need to construct the shape expected by UI if it relies on specific mapped fields
                        // But let's check ReplicaSetDetails. It uses metadata, spec, status directly.
                        resource = fetched;
                        // Add a type property so handleResourceClick handles it
                        resource.type = 'replicaset';
                    }
                } else if (lowerKind === 'deployment') {
                    const fetched = await window.k8s.getDeployment(clusterName, namespace, name);
                    if (fetched) resource = fetched;
                }
            } catch (err) {
                console.error(`Failed to fetch ${kind}/${name}`, err);
            }
        }

        console.log('Found resource:', resource);

        if (resource) {
            // Temporarily close drawer to trigger animation or just switch data
            // For smoother transitions we just update logic
            handleResourceClick(resource, lowerKind as any);
        } else {
            console.warn(`Could not find resource ${kind}/${name} to navigate to.`);
        }
    };

    const handleDeletePod = async () => {
        if (!selectedResource || selectedResource.type !== 'pod') return;

        const confirmMsg = `Are you sure you want to delete pod ${selectedResource.name}?`;
        if (confirm(confirmMsg)) {
            try {
                await window.k8s.deletePod(clusterName, selectedResource.namespace, selectedResource.name);
                setIsDrawerOpen(false);
                // Optimistic update or wait for watcher? Watcher should handle it.
            } catch (e) {
                console.error("Failed to delete pod", e);
                alert("Failed to delete pod.");
            }
        }
    };

    const handleScaleDeployment = async (replicas: number) => {
        if (!selectedResource || !clusterName) return;
        try {
            await window.k8s.scaleDeployment(
                clusterName,
                selectedResource.namespace,
                selectedResource.name,
                replicas
            );
            // Refresh data
            await loadResources();
            // Update detailed resource if currently viewed
            handleResourceClick(selectedResource, selectedResource.type);
        } catch (err) {
            console.error("Failed to scale", err);
        }
    };

    const pageVariants = {
        initial: { opacity: 0, y: 10 },
        in: { opacity: 1, y: 0 },
        out: { opacity: 0, y: -10 }
    };

    const pageTransition = {
        type: "tween",
        ease: "anticipate",
        duration: 0.3
    } as const;

    const getResourceCount = () => {
        if (activeView === 'deployments') return deployments.length;
        if (activeView === 'pods') return pods.length;
        if (activeView === 'replicasets') return replicaSets.length;
        if (activeView === 'services') return services.length;
        if (activeView === 'configmaps') return configMaps.length;
        if (activeView === 'secrets') return secrets.length;
        if (activeView === 'ingresses') return ingresses.length;
        if (activeView === 'ingressclasses') return ingressClasses.length;
        if (activeView === 'persistentvolumeclaims') return pvcs.length;
        if (activeView === 'persistentvolumes') return pvs.length;
        if (activeView === 'storageclasses') return storageClasses.length;
        if (activeView === 'nodes') return nodes.length;
        if (activeView === 'namespaces') return namespacesList.length;
        if (activeView === 'serviceaccounts') return serviceAccounts.length;
        if (activeView === 'roles') return roles.length;
        if (activeView === 'roles') return roles.length;
        if (activeView === 'clusterroles') return clusterRoles.length;
        if (activeView === 'clusterrolebindings') return clusterRoleBindings.length;
        if (activeView === 'rolebindings') return roleBindings.length;
        if (activeView === 'daemonsets') return daemonSets.length;
        if (activeView === 'statefulsets') return statefulSets.length;
        if (activeView === 'jobs') return jobs.length;
        if (activeView === 'cronjobs') return cronJobs.length;
        if (activeView === 'endpointslices') return endpointSlices.length;
        if (activeView === 'endpoints') return endpoints.length;
        if (activeView === 'networkpolicies') return networkPolicies.length;
        if (activeView === 'horizontalpodautoscalers') return horizontalPodAutoscalers.length;
        if (activeView === 'poddisruptionbudgets') return podDisruptionBudgets.length;
        if (activeView === 'mutatingwebhookconfigurations') return mutatingWebhookConfigurations.length;
        if (activeView === 'validatingwebhookconfigurations') return validatingWebhookConfigurations.length;
        if (activeView === 'priorityclasses') return priorityClasses.length;
        if (activeView === 'runtimeclasses') return runtimeClasses.length;
        if (activeView === 'crd-definitions') return crdDefinitions.length;
        if (activeView.startsWith('crd/')) return (customObjects && typeof customObjects === 'object' && 'items' in customObjects) ? (customObjects.items as any[]).length : (Array.isArray(customObjects) ? customObjects.length : 0);
        return 0;
    };

    const resourceCount = getResourceCount();

    return (
        <div className="flex flex-col h-full relative" >
            {/* Top Bar */}
            < div className="flex-none p-4 sm:p-6 border border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl" >
                <div className="flex items-center gap-4 flex-none max-w-full">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-900/20 flex-none">
                        <Layers className="text-white" size={20} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold text-white tracking-tight capitalize whitespace-nowrap truncate">{isCrdView ? currentCrdKind : activeView}</h1>
                        <div className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 whitespace-nowrap">
                                <Network size={12} className="text-blue-400" />
                                {clusterName}
                            </span>
                            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-gray-300 whitespace-nowrap">
                                {resourceCount} Total
                            </span>
                        </div>
                    </div>

                </div>

                <div className="flex items-center gap-3 flex-wrap flex-1 justify-end min-w-[200px]">
                    {/* Search Input */}
                    <div className="relative group w-full sm:w-64">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-4 w-4 text-gray-500 group-focus-within:text-blue-400 transition-colors" />
                        </div>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search resources..."
                            className="block w-full pl-10 pr-3 py-2 border border-white/10 rounded-md leading-5 bg-black/20 text-gray-300 placeholder-gray-500 focus:outline-none focus:bg-white/5 focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 sm:text-sm transition-all"
                        />
                    </div>
                    {/* Pod View Toggle */}
                    {activeView === 'pods' && (
                        <div className="flex bg-black/40 p-1 rounded-lg border border-white/10 flex-none">
                            <button
                                onClick={() => setPodViewMode('list')}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all border ${podViewMode === 'list'
                                    ? 'bg-blue-600/20 text-blue-400 border-blue-600/30 shadow-lg'
                                    : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <Layers size={14} /> List
                            </button>
                            <button
                                onClick={() => setPodViewMode('visual')}
                                className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all border ${podViewMode === 'visual'
                                    ? 'bg-blue-600/20 text-blue-400 border-blue-600/30 shadow-lg'
                                    : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <Square size={14} /> Visual
                            </button>
                        </div>
                    )}

                    <div className="flex-none">
                        <NamespaceSelector
                            namespaces={namespaces}
                            selected={selectedNamespaces}
                            onChange={setSelectedNamespaces}
                        />
                    </div>
                    {activeView === 'services' && (
                        <button
                            onClick={async () => {
                                if (confirm('Stop all active port forwards?')) {
                                    await window.k8s.stopAllPortForwards();
                                    // Optionally trigger a refresh or toast
                                }
                            }}
                            className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs border border-red-500/20 rounded flex items-center gap-2 transition-colors whitespace-nowrap"
                        >
                            <Square size={14} fill="currentColor" />
                            Stop All Forwards
                        </button>
                    )}
                </div>
            </div >

            {/* Content Area */}
            < div className="flex-1 overflow-y-auto p-6 pb-4" >
                {/* NODES TABLE */}
                {/* NODES TABLE */}
                {
                    (activeView === 'nodes') && (
                        <NodesView
                            nodes={nodes}
                            onRowClick={(node: any) => handleResourceClick(node, 'node')}
                            searchQuery={searchQuery}
                        />
                    )
                }

                {
                    (activeView === 'backgrounds') && (
                        null
                    )
                }

                {
                    (activeView === 'namespaces') && (
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
                            onRowClick={(ns: any) => handleResourceClick({ ...ns, type: 'namespace' }, 'namespace' as any)}
                            searchQuery={searchQuery}
                        />
                    )
                }

                {
                    (activeView === 'certificates') && (
                        <CertManagerView clusterName={clusterName} searchQuery={searchQuery} />
                    )
                }

                {/* CUSTOM RESOURCES TABLE */}
                {/* CUSTOM RESOURCES TABLE */}
                {
                    (isCrdView) && (
                        <GenericResourceView
                            viewKey={`crd-${currentCrdKind}`}
                            description={currentCrdKind || 'Custom Resources'}

                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns || '-'}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={customObjects}
                            onRowClick={(obj: any) => handleResourceClick(obj, 'custom-resource')}
                            searchQuery={searchQuery}
                        />
                    )
                }

                {/* CRD DEFINITIONS TABLE */}
                {/* CRD DEFINITIONS TABLE */}
                {
                    activeView === 'crd-definitions' && (
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
                            onRowClick={(crd: any) => handleResourceClick(crd, 'crd-definition')}
                            searchQuery={searchQuery}
                        />
                    )
                }

                <AnimatePresence mode="wait">
                    {/* OVERVIEW DASHBOARD */}
                    {activeView === 'overview' && (
                        <motion.div
                            key="overview-dashboard"
                            initial="initial"
                            animate="in"
                            exit="out"
                            variants={pageVariants}
                            transition={pageTransition}
                        >
                            <OverviewView
                                pods={pods}
                                deployments={deployments}
                                events={events}
                                isLoading={loading}
                                onNavigate={onNavigate}
                                onSwitchToVisualPods={() => setPodViewMode('visual')}
                            />
                        </motion.div>
                    )}

                    {/* DEPLOYMENTS TABLE */}
                    {/* DEPLOYMENTS TABLE */}
                    {/* DEPLOYMENTS TABLE */}
                    {(activeView === 'deployments') && (
                        <DeploymentsView
                            deployments={deployments}
                            isLoading={loading}
                            clusterName={clusterName}
                            selectedNamespaces={selectedNamespaces}
                            searchQuery={searchQuery}
                            onRowClick={(dep) => handleResourceClick(dep, 'deployment')}
                        />
                    )}

                    {/* PODS TABLE */}
                    {(activeView === 'pods') && (
                        <PodsView
                            viewMode={podViewMode}
                            pods={pods}
                            sortedPods={getSortedData(pods)}
                            nodes={nodes}
                            sortConfig={sortConfig}
                            onSort={handleSort}
                            onRowClick={(pod: any) => handleResourceClick(pod, 'pod')}
                            searchQuery={searchQuery}
                            isLoading={loading}
                        />
                    )}

                    {/* REPLICA SETS TABLE */}
                    {/* REPLICA SETS TABLE */}
                    {(activeView === 'replicasets') && (
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
                            onRowClick={(rs: any) => handleResourceClick(rs, 'replicaset')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* SERVICES TABLE */}
                    {/* SERVICES TABLE */}
                    {(activeView === 'services') && (
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
                            onRowClick={(svc: any) => handleResourceClick(svc, 'service')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* CLUSTER ROLE BINDINGS TABLE */}
                    {/* CLUSTER ROLE BINDINGS TABLE */}
                    {(activeView === 'clusterrolebindings') && (
                        <GenericResourceView
                            viewKey="clusterrolebindings"
                            description="Cluster-wide access control and permission bindings."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400">{new Date(age).toLocaleDateString()}</span> }
                            ]}
                            data={clusterRoleBindings}
                            onRowClick={(crb: any) => handleResourceClick(crb, 'clusterrolebinding')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* ROLE BINDINGS TABLE */}
                    {/* ROLE BINDINGS TABLE */}
                    {(activeView === 'rolebindings') && (
                        <GenericResourceView
                            viewKey="rolebindings"
                            description="Namespace-scoped permissions and access control."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400">{new Date(age).toLocaleDateString()}</span> }
                            ]}
                            data={roleBindings}
                            onRowClick={(rb: any) => handleResourceClick(rb, 'rolebinding')}
                            searchQuery={searchQuery}
                        />
                    )}


                    {/* SERVICE ACCOUNTS TABLE */}
                    {/* SERVICE ACCOUNTS TABLE */}
                    {(activeView === 'serviceaccounts') && (
                        <GenericResourceView
                            viewKey="serviceaccounts"
                            description="Identities for processes that run in a Pod."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Secrets', dataKey: 'secrets', flexGrow: 1, cellRenderer: (s) => <span className="text-gray-400">{s}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400">{new Date(age).toLocaleDateString()}</span> }
                            ]}
                            data={serviceAccounts}
                            onRowClick={(sa: any) => handleResourceClick(sa, 'serviceaccount')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* ROLES TABLE */}
                    {/* ROLES TABLE */}
                    {(activeView === 'roles') && (
                        <GenericResourceView
                            viewKey="roles"
                            description="Sets of permissions within a specific namespace."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400">{new Date(age).toLocaleDateString()}</span> }
                            ]}
                            data={roles}
                            onRowClick={(r: any) => handleResourceClick(r, 'role')}
                            searchQuery={searchQuery}
                        />
                    )}
                    {/* CLUSTER ROLES TABLE */}
                    {(activeView === 'clusterroles') && (
                        <GenericResourceView
                            viewKey="clusterroles"
                            description="Cluster-wide permissions."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400">{new Date(age).toLocaleDateString()}</span> }
                            ]}
                            data={clusterRoles}
                            onRowClick={(cr: any) => handleResourceClick(cr, 'clusterrole')}
                            searchQuery={searchQuery}
                        />
                    )}
                    {/* DAEMONSETS TABLE */}
                    {/* DAEMONSETS TABLE */}
                    {(activeView === 'daemonsets') && (
                        <GenericResourceView
                            viewKey="daemonsets"
                            description="Ensures that all (or some) Nodes run a copy of a Pod."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Desired', dataKey: 'desired', width: 80, flexGrow: 0, cellRenderer: (d) => <span className="text-gray-400">{d}</span> },
                                { label: 'Current', dataKey: 'current', width: 80, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                                { label: 'Ready', dataKey: 'ready', width: 80, flexGrow: 0, cellRenderer: (r) => <span className="text-gray-400">{r}</span> },
                                { label: 'Available', dataKey: 'available', width: 80, flexGrow: 0, cellRenderer: (a) => <span className="text-gray-400">{a}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={daemonSets}
                            onRowClick={(ds: any) => handleResourceClick(ds, 'daemonset')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* STATEFULSETS TABLE */}
                    {/* STATEFULSETS TABLE */}
                    {(activeView === 'statefulsets') && (
                        <GenericResourceView
                            viewKey="statefulsets"
                            description="Manages the deployment and scaling of a set of Pods, and provides guarantees about the ordering and uniqueness of these Pods."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Replicas', dataKey: 'replicas', width: 80, flexGrow: 0, cellRenderer: (r) => <span className="text-gray-400">{r}</span> },
                                { label: 'Ready', dataKey: 'ready', width: 80, flexGrow: 0, cellRenderer: (r) => <span className="text-gray-400">{r}</span> },
                                { label: 'Current', dataKey: 'current', width: 80, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={statefulSets}
                            onRowClick={(sts: any) => handleResourceClick(sts, 'statefulset')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* JOBS TABLE */}
                    {/* JOBS TABLE */}
                    {(activeView === 'jobs') && (
                        <GenericResourceView
                            viewKey="jobs"
                            description="A Job creates one or more Pods and will continue to retry execution of the Pods until a specified number of them successfully terminate."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Completions', dataKey: 'completions', width: 100, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                                { label: 'Succeeded', dataKey: 'succeeded', width: 100, flexGrow: 0, cellRenderer: (s) => <span className="text-green-400">{s}</span> },
                                { label: 'Active', dataKey: 'active', width: 100, flexGrow: 0, cellRenderer: (a) => <span className="text-blue-400">{a}</span> },
                                { label: 'Failed', dataKey: 'failed', width: 100, flexGrow: 0, cellRenderer: (f) => <span className="text-red-400">{f}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={jobs}
                            onRowClick={(job: any) => handleResourceClick(job, 'job')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* CRONJOBS TABLE */}
                    {/* CRONJOBS TABLE */}
                    {(activeView === 'cronjobs') && (
                        <GenericResourceView
                            viewKey="cronjobs"
                            description="Runs Jobs on a time-based schedule."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Schedule', dataKey: 'schedule', flexGrow: 1, cellRenderer: (s) => <span className="text-gray-400 font-mono text-xs">{s}</span> },
                                { label: 'Suspend', dataKey: 'suspend', width: 80, flexGrow: 0, cellRenderer: (s) => <span className="text-gray-400">{s ? 'True' : 'False'}</span> },
                                { label: 'Active', dataKey: 'active', width: 80, flexGrow: 0, cellRenderer: (a) => <span className="text-gray-400">{a}</span> },
                                { label: 'Last Schedule', dataKey: 'lastScheduleTime', width: 120, flexGrow: 0, cellRenderer: (t) => <span className="text-gray-400">{t ? <TimeAgo timestamp={t} /> : '-'}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={cronJobs}
                            onRowClick={(cj: any) => handleResourceClick(cj, 'cronjob')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* NETWORK: ENDPOINT SLICES */}
                    {/* NETWORK: ENDPOINT SLICES */}
                    {(activeView === 'endpointslices') && (
                        <GenericResourceView
                            viewKey="endpointslices"
                            description="Scalable and extensible way to group network endpoints together."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Address Type', dataKey: 'addressType', width: 120, flexGrow: 0, cellRenderer: (at) => <span className="text-gray-400">{at}</span> },
                                { label: 'Ports', dataKey: 'ports', flexGrow: 1, cellRenderer: (p) => <span className="text-gray-400">{p}</span> },
                                { label: 'Endpoints', dataKey: 'endpoints', flexGrow: 1, cellRenderer: (e) => <span className="text-gray-400">{e}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={endpointSlices}
                            onRowClick={(es: any) => handleResourceClick(es, 'endpointslice')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* NETWORK: ENDPOINTS */}
                    {/* NETWORK: ENDPOINTS */}
                    {(activeView === 'endpoints') && (
                        <GenericResourceView
                            viewKey="endpoints"
                            description="A list of IP addresses and ports for a Service."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Subsets', dataKey: 'subsets', flexGrow: 1, cellRenderer: (s) => <span className="text-gray-400">{s}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={endpoints}
                            onRowClick={(ep: any) => handleResourceClick(ep, 'endpoint')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* NETWORK: INGRESSES */}
                    {/* NETWORK: INGRESSES */}
                    {(activeView === 'ingresses') && (
                        <GenericResourceView
                            viewKey="ingresses"
                            description="Manages external access to the services in a cluster, typically HTTP."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Class', dataKey: 'class', width: 100, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                                { label: 'Hosts', dataKey: 'hosts', flexGrow: 1, cellRenderer: (h) => <span className="text-gray-400 font-mono text-xs">{h}</span> },
                                { label: 'Address', dataKey: 'address', width: 120, flexGrow: 0, cellRenderer: (a) => <span className="text-gray-400">{a}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={ingresses}
                            onRowClick={(ing: any) => handleResourceClick(ing, 'ingress')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* NETWORK: INGRESS CLASSES */}
                    {/* NETWORK: INGRESS CLASSES */}
                    {(activeView === 'ingressclasses') && (
                        <GenericResourceView
                            viewKey="ingressclasses"
                            description="Defines a type of Ingress controller."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Controller', dataKey: 'controller', flexGrow: 1, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                                { label: 'API Group', dataKey: 'apiGroup', width: 120, flexGrow: 0, cellRenderer: (g) => <span className="text-gray-400">{g || '-'}</span> },
                                { label: 'Kind', dataKey: 'kind', width: 100, flexGrow: 0, cellRenderer: (k) => <span className="text-gray-400">{k || '-'}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={ingressClasses}
                            onRowClick={(ic: any) => handleResourceClick(ic, 'ingressclass')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* NETWORK: NETWORK POLICIES */}
                    {/* NETWORK: NETWORK POLICIES */}
                    {(activeView === 'networkpolicies') && (
                        <GenericResourceView
                            viewKey="networkpolicies"
                            description="Controls how groups of Pods are allowed to communicate with each other and other network endpoints."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Pod Selector', dataKey: 'podSelector', flexGrow: 1, cellRenderer: (ps) => <span className="text-gray-400">{ps}</span> },
                                { label: 'Policy Types', dataKey: 'policyTypes', flexGrow: 1, cellRenderer: (pt) => <span className="text-gray-400">{pt}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={networkPolicies}
                            onRowClick={(np: any) => handleResourceClick(np, 'networkpolicy')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* STORAGE: PVC */}
                    {/* STORAGE: PVC */}
                    {(activeView === 'persistentvolumeclaims') && (
                        <GenericResourceView
                            viewKey="pvcs"
                            description="A request for storage by a user."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Status', dataKey: 'status', width: 100, flexGrow: 0, cellRenderer: (s) => <span className="text-gray-400">{s}</span> },
                                { label: 'Volume', dataKey: 'volume', flexGrow: 1, cellRenderer: (v) => <span className="text-gray-400">{v}</span> },
                                { label: 'Capacity', dataKey: 'capacity', width: 100, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                                { label: 'Access Modes', dataKey: 'accessModes', flexGrow: 1, cellRenderer: (am) => <span className="text-gray-400">{am}</span> },
                                { label: 'Storage Class', dataKey: 'storageClass', flexGrow: 1, cellRenderer: (sc) => <span className="text-gray-400">{sc}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={pvcs}
                            onRowClick={(pvc: any) => handleResourceClick(pvc, 'persistentvolumeclaim')}
                        />
                    )}

                    {/* STORAGE: PV */}
                    {(activeView === 'persistentvolumes') && (
                        <GenericResourceView
                            viewKey="persistentvolumes"
                            description="A piece of storage in the cluster that has been provisioned by an administrator or dynamically provisioned using Storage Classes."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Capacity', dataKey: 'capacity', width: 100, flexGrow: 0, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                                { label: 'Access Modes', dataKey: 'accessModes', flexGrow: 1, cellRenderer: (am) => <span className="text-gray-400">{am}</span> },
                                { label: 'Reclaim', dataKey: 'reclaimPolicy', width: 100, flexGrow: 0, cellRenderer: (rp) => <span className="text-gray-400">{rp}</span> },
                                { label: 'Status', dataKey: 'status', width: 100, flexGrow: 0, cellRenderer: (s) => <span className="text-gray-400">{s}</span> },
                                { label: 'Claim', dataKey: 'claim', flexGrow: 1, cellRenderer: (c) => <span className="text-gray-400">{c}</span> },
                                { label: 'Storage Class', dataKey: 'storageClass', flexGrow: 1, cellRenderer: (sc) => <span className="text-gray-400">{sc}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={pvs}
                            onRowClick={(pv: any) => handleResourceClick(pv, 'persistentvolume')}
                        />
                    )}

                    {/* STORAGE: STORAGE CLASSES */}
                    {(activeView === 'storageclasses') && (
                        <GenericResourceView
                            viewKey="storageclasses"
                            description="Describes the classes of storage offered by the cluster."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Provisioner', dataKey: 'provisioner', flexGrow: 1, cellRenderer: (p) => <span className="text-gray-400">{p}</span> },
                                { label: 'Reclaim Policy', dataKey: 'reclaimPolicy', width: 120, flexGrow: 0, cellRenderer: (rp) => <span className="text-gray-400">{rp}</span> },
                                { label: 'Volume Binding Mode', dataKey: 'volumeBindingMode', width: 150, flexGrow: 0, cellRenderer: (vbm) => <span className="text-gray-400">{vbm}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={storageClasses}
                            onRowClick={(sc: any) => handleResourceClick(sc, 'storageclass')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {/* CONFIG RESOURCES */}
                    {(activeView === 'configmaps') && (
                        <GenericResourceView
                            viewKey="configmaps"
                            description="ConfigMaps allow you to decouple configuration artifacts from image content."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Data Keys', dataKey: 'data', flexGrow: 1, cellRenderer: (d) => <span className="text-gray-400">{d}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={configMaps}
                            onRowClick={(cm: any) => handleResourceClick(cm, 'configmap')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {(activeView === 'secrets') && (
                        <GenericResourceView
                            viewKey="secrets"
                            description="Secrets let you store and manage sensitive information."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Type', dataKey: 'type', width: 120, flexGrow: 0, cellRenderer: (t) => <span className="text-gray-400 text-xs">{t}</span> },
                                { label: 'Data Keys', dataKey: 'data', flexGrow: 1, cellRenderer: (d) => <span className="text-gray-400">{d}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={secrets}
                            onRowClick={(secret: any) => handleResourceClick(secret, 'secret')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {(activeView === 'horizontalpodautoscalers') && (
                        <GenericResourceView
                            viewKey="horizontalpodautoscalers"
                            description="Automatically scales the number of pods based on observed metrics."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Reference', dataKey: 'reference', flexGrow: 1, cellRenderer: (r) => <span className="text-blue-400 text-sm">{r}</span> },
                                { label: 'Min Pods', dataKey: 'minPods', width: 80, flexGrow: 0, cellRenderer: (min) => <span className="text-gray-400">{min}</span> },
                                { label: 'Max Pods', dataKey: 'maxPods', width: 80, flexGrow: 0, cellRenderer: (max) => <span className="text-gray-400">{max}</span> },
                                { label: 'Replicas', dataKey: 'replicas', width: 80, flexGrow: 0, cellRenderer: (r) => <span className="text-gray-400">{r}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={horizontalPodAutoscalers}
                            onRowClick={(hpa: any) => handleResourceClick(hpa, 'horizontalpodautoscaler')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {(activeView === 'poddisruptionbudgets') && (
                        <GenericResourceView
                            viewKey="poddisruptionbudgets"
                            description="Limits the number of pods that can be down simultaneously from voluntary disruptions."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Namespace', dataKey: 'namespace', sortable: true, flexGrow: 1, cellRenderer: (ns) => <span className="text-gray-400">{ns}</span> },
                                { label: 'Min Available', dataKey: 'minAvailable', width: 100, flexGrow: 0, cellRenderer: (ma) => <span className="text-gray-400">{ma || '-'}</span> },
                                { label: 'Max Unavailable', dataKey: 'maxUnavailable', width: 100, flexGrow: 0, cellRenderer: (mu) => <span className="text-gray-400">{mu || '-'}</span> },
                                { label: 'Allowed Disruptions', dataKey: 'allowed', width: 120, flexGrow: 0, cellRenderer: (ad) => <span className="text-gray-400">{ad}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={podDisruptionBudgets}
                            onRowClick={(pdb: any) => handleResourceClick(pdb, 'poddisruptionbudget')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {(activeView === 'mutatingwebhookconfigurations') && (
                        <GenericResourceView
                            viewKey="mutatingwebhookconfigurations"
                            description="Defines admission webhooks that can mutate objects before they are stored."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Webhooks', dataKey: 'webhooks', flexGrow: 1, cellRenderer: (w) => <span className="text-gray-400">{w}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={mutatingWebhookConfigurations}
                            onRowClick={(mwc: any) => handleResourceClick(mwc, 'mutatingwebhookconfiguration')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {(activeView === 'validatingwebhookconfigurations') && (
                        <GenericResourceView
                            viewKey="validatingwebhookconfigurations"
                            description="Defines admission webhooks that can validate objects before they are stored."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Webhooks', dataKey: 'webhooks', flexGrow: 1, cellRenderer: (w) => <span className="text-gray-400">{w}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={validatingWebhookConfigurations}
                            onRowClick={(vwc: any) => handleResourceClick(vwc, 'validatingwebhookconfiguration')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {(activeView === 'priorityclasses') && (
                        <GenericResourceView
                            viewKey="priorityclasses"
                            description="Defines the priority of pods relative to other pods."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Value', dataKey: 'value', width: 100, flexGrow: 0, cellRenderer: (v) => <span className="text-gray-400">{v}</span> },
                                { label: 'Global Default', dataKey: 'globalDefault', width: 100, flexGrow: 0, cellRenderer: (gd) => <span className="text-gray-400">{gd ? 'Yes' : 'No'}</span> },
                                { label: 'Description', dataKey: 'description', flexGrow: 1, cellRenderer: (d) => <span className="text-gray-400 text-sm max-w-xs truncate">{d || '-'}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={priorityClasses}
                            onRowClick={(pc: any) => handleResourceClick(pc, 'priorityclass')}
                            searchQuery={searchQuery}
                        />
                    )}

                    {(activeView === 'runtimeclasses') && (
                        <GenericResourceView
                            viewKey="runtimeclasses"
                            description="Defines different classes of runtimes that may be used to run containers."
                            columns={[
                                { label: 'Name', dataKey: 'name', sortable: true, flexGrow: 2, cellRenderer: (name) => <span className="font-medium text-gray-200">{name}</span> },
                                { label: 'Handler', dataKey: 'handler', flexGrow: 1, cellRenderer: (h) => <span className="text-gray-400">{h}</span> },
                                { label: 'Age', dataKey: 'age', sortable: true, width: 120, flexGrow: 0, cellRenderer: (age) => <span className="text-gray-400"><TimeAgo timestamp={age} /></span> }
                            ]}
                            data={runtimeClasses}
                            onRowClick={(rc: any) => handleResourceClick(rc, 'runtimeclass')}
                            searchQuery={searchQuery}
                        />
                    )}
                </AnimatePresence>



            </div >
            {/* ... (Previous code) ... */}
            < Drawer
                isOpen={isDrawerOpen}
                onClose={() => {
                    if (!isScaleModalOpen) {
                        setIsDrawerOpen(false);
                    }
                }}
                title={selectedResource?.name || 'Details'}
                headerActions={
                    < div className="flex items-center gap-2" >
                        {(selectedResource?.type === 'deployment' || selectedResource?.type === 'poddisruptionbudget') && onOpenYaml && (
                            <button
                                onClick={() => {
                                    onOpenYaml(selectedResource);
                                    setIsDrawerOpen(false);
                                }}
                                className="p-1.5 hover:bg-white/10 text-gray-400 hover:text-blue-400 rounded transition-colors"
                                title="Edit YAML"
                            >
                                <PenTool size={18} />
                            </button>
                        )}

                        {
                            selectedResource?.type === 'deployment' && (
                                <button
                                    onClick={() => setIsScaleModalOpen(true)}
                                    className="p-1 px-3 ml-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/30 rounded-md text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors"
                                    title="Scale Deployment"
                                >
                                    <Activity size={14} /> Scale
                                </button>
                            )
                        }

                        {
                            (selectedResource?.type === 'deployment' || selectedResource?.type === 'daemonset' || selectedResource?.type === 'statefulset') && (
                                <button
                                    onClick={async () => {
                                        const name = selectedResource.metadata?.name || selectedResource.name;
                                        const namespace = selectedResource.metadata?.namespace || selectedResource.namespace;

                                        if (confirm(`Are you sure you want to restart ${selectedResource.type} ${name}?`)) {
                                            try {
                                                if (selectedResource.type === 'deployment') {
                                                    await window.k8s.restartDeployment(clusterName, namespace, name);
                                                } else if (selectedResource.type === 'daemonset') {
                                                    await window.k8s.restartDaemonSet(clusterName, namespace, name);
                                                } else if (selectedResource.type === 'statefulset') {
                                                    await window.k8s.restartStatefulSet(clusterName, namespace, name);
                                                }
                                            } catch (e) {
                                                console.error(e);
                                                alert(`Failed to restart ${selectedResource.type}`);
                                            }
                                        }
                                    }}
                                    className="p-1 px-3 ml-2 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 border border-orange-600/30 rounded-md text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors"
                                    title="Rolling Restart"
                                >
                                    <RotateCcw size={14} /> Restart
                                </button>
                            )
                        }

                        {
                            selectedResource?.type === 'pod' && (
                                <button
                                    onClick={handleDeletePod}
                                    className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded transition-colors"
                                    title="Delete Pod"
                                >
                                    <Trash size={16} />
                                </button>
                            )
                        }
                    </div >
                }

            >
                <ErrorBoundary name="DrawerDetails">
                    {detailedResource ? (
                        <>
                            {/* Topology View */}
                            {drawerTab === 'topology' && selectedResource && (
                                <ResourceTopology clusterName={clusterName} resource={detailedResource || selectedResource} />
                            )}

                            {/* Details View */}
                            {drawerTab === 'details' && (
                                <DrawerDetailsRenderer
                                    selectedResource={selectedResource}
                                    detailedResource={detailedResource}
                                    clusterName={clusterName}
                                    onExplain={handleExplain}
                                    onNavigate={handleNavigate}
                                    onOpenLogs={handleOpenLogs}
                                    onShowTopology={() => setDrawerTab('topology')}
                                />
                            )}
                        </>
                    ) : (
                        <div className="flex items-center justify-center h-64">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                        </div>
                    )}
                </ErrorBoundary>
            </Drawer >

            <AnimatePresence>
                {isScaleModalOpen && selectedResource && (
                    <ScaleModal
                        isOpen={isScaleModalOpen}
                        onClose={() => setIsScaleModalOpen(false)}
                        currentReplicas={detailedResource?.spec?.replicas || selectedResource.replicas || 0}
                        resourceName={selectedResource.name}
                        onScale={handleScaleDeployment}
                    />
                )}
            </AnimatePresence>

        </div >
    );
}

// ResourceTable and StatusBadge moved to shared components
