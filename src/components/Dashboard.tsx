import React, { useState, useEffect, useRef, useTransition } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
    Activity,
    PenTool,
    Trash,
    RotateCcw
} from 'lucide-react';

import { ErrorBoundary } from './shared/ErrorBoundary';
import { Drawer } from './shared/Drawer';
import { DrawerDetailsRenderer } from './dashboard/DrawerDetailsRenderer';
import { ResourceTopology } from './resources/visualizers/ResourceTopology';
import { ScaleModal } from './shared/ScaleModal';
import { DashboardContent } from './dashboard/DashboardContent';
import { DashboardHeader } from './dashboard/DashboardHeader';
import { useResourceSorting } from '../hooks/useResourceSorting';

interface DashboardProps {
    clusterName: string;
    activeView: string;
    onOpenLogs: (pod: any, containerName: string) => void;
    onNavigate?: (view: string) => void;
    onOpenYaml?: (deployment: any) => void;
    onExplain?: (resource: any) => void;
    onExec?: (pod: any, containerName: string) => void;
}


export const Dashboard: React.FC<DashboardProps> = ({ clusterName, activeView, onOpenLogs, onNavigate, onOpenYaml, onExplain, onExec }) => {
    const [namespaces, setNamespaces] = useState<string[]>([]);
    const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>(['all']);

    // Performance: Use transition for non-urgent state updates
    const [, startTransition] = useTransition();

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

    // Performance: Resource cache to prevent unnecessary refetches
    const resourceCacheRef = useRef<Map<string, { data: any[]; timestamp: number }>>(new Map());
    const CACHE_TTL = 30000; // 30 seconds

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
    const [podMetrics, setPodMetrics] = useState<Record<string, { cpu: string; memory: string }>>({});

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
    const [summariesEnabled, setSummariesEnabled] = useState(false);

    // Fetch context engine config for summariesEnabled
    useEffect(() => {
        (window as any).k8s.settings.getContextConfig().then((config: any) => {
            setSummariesEnabled(config?.summariesEnabled ?? false);
        }).catch(() => { });
    }, []);

    // Sorting State
    const { sortConfig, handleSort, getSortedData } = useResourceSorting();
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

    // Performance: Debounce search input to reduce re-renders
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Clear search when active view changes
    useEffect(() => {
        setSearchQuery('');
        setDebouncedSearchQuery('');
    }, [activeView]);


    const handleOpenLogs = (pod: any, containerName: string) => {
        // Pass up to parent
        onOpenLogs(pod, containerName);
        setIsDrawerOpen(false);
    };








    // Track active view to prevent race conditions
    const activeViewRef = useRef(activeView);
    useEffect(() => {
        activeViewRef.current = activeView;
    }, [activeView]);

    // Performance: Helper to get current view data for cache check
    const getCurrentViewData = () => {
        if (activeView === 'overview') return pods.length > 0 || deployments.length > 0;
        if (activeView === 'pods') return pods.length > 0;
        if (activeView === 'deployments') return deployments.length > 0;
        if (activeView === 'replicasets') return replicaSets.length > 0;
        if (activeView === 'services') return services.length > 0;
        if (activeView === 'nodes') return nodes.length > 0;
        if (activeView === 'daemonsets') return daemonSets.length > 0;
        if (activeView === 'statefulsets') return statefulSets.length > 0;
        if (activeView === 'jobs') return jobs.length > 0;
        if (activeView === 'cronjobs') return cronJobs.length > 0;
        if (activeView === 'namespaces') return namespacesList.length > 0;
        if (activeView === 'clusterroles') return clusterRoles.length > 0;
        if (activeView === 'clusterrolebindings') return clusterRoleBindings.length > 0;
        if (activeView === 'roles') return roles.length > 0;
        if (activeView === 'rolebindings') return roleBindings.length > 0;
        if (activeView === 'serviceaccounts') return serviceAccounts.length > 0;
        if (activeView === 'endpointslices') return endpointSlices.length > 0;
        if (activeView === 'endpoints') return endpoints.length > 0;
        if (activeView === 'ingresses') return ingresses.length > 0;
        if (activeView === 'ingressclasses') return ingressClasses.length > 0;
        if (activeView === 'networkpolicies') return networkPolicies.length > 0;
        if (activeView === 'persistentvolumeclaims') return pvcs.length > 0;
        if (activeView === 'persistentvolumes') return pvs.length > 0;
        if (activeView === 'storageclasses') return storageClasses.length > 0;
        if (activeView === 'configmaps') return configMaps.length > 0;
        if (activeView === 'secrets') return secrets.length > 0;
        if (activeView === 'horizontalpodautoscalers') return horizontalPodAutoscalers.length > 0;
        if (activeView === 'poddisruptionbudgets') return podDisruptionBudgets.length > 0;
        if (activeView === 'mutatingwebhookconfigurations') return mutatingWebhookConfigurations.length > 0;
        if (activeView === 'validatingwebhookconfigurations') return validatingWebhookConfigurations.length > 0;
        if (activeView === 'priorityclasses') return priorityClasses.length > 0;
        if (activeView === 'runtimeclasses') return runtimeClasses.length > 0;
        if (activeView === 'crd-definitions') return crdDefinitions.length > 0;
        return false;
    };

    // Performance: Check if cache is valid
    const getCachedData = (cacheKey: string) => {
        const cached = resourceCacheRef.current.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
        return null;
    };

    // Performance: Store data in cache
    const setCachedData = (cacheKey: string, data: any[]) => {
        resourceCacheRef.current.set(cacheKey, {
            data,
            timestamp: Date.now()
        });
    };

    // Load Namespaces & Wipe State on Cluster Change
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
    }, [clusterName]);

    // Independent Namespace Detail Loading
    useEffect(() => {
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

    // Watcher Effect - Performance: Only watch when view is active
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        let batchTimeout: ReturnType<typeof setTimeout> | null = null;
        const pendingUpdates = new Map<string, { type: string; pod: any }>();

        // Performance: Only watch if we are in a view that needs pods
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

                // Performance: Use startTransition to mark updates as non-urgent
                startTransition(() => {
                    setPods(prev => {
                        // Performance: Only create Map if we have updates
                        if (updates.size === 0) return prev;

                        // Use a Map for O(1) updates instead of O(N) array scans
                        const podMap = new Map(prev.map(p => [`${p.namespace}/${p.name}`, p]));

                        updates.forEach(({ type, pod }) => {
                            const key = `${pod.namespace}/${pod.name}`;

                            // Strict Filtering: If not viewing 'all' namespaces, check if pod belongs to selected namespaces
                            const isSelected = selectedNamespaces.includes('all') || selectedNamespaces.includes(pod.namespace);

                            if (type === 'ADDED' || type === 'MODIFIED') {
                                if (isSelected) {
                                    podMap.set(key, pod);
                                } else {
                                    if (podMap.has(key)) podMap.delete(key);
                                }
                            } else if (type === 'DELETED') {
                                podMap.delete(key);
                            }
                        });

                        return Array.from(podMap.values());
                    });
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
            // Performance: Clean up watchers when view changes or component unmounts
            if (cleanup) cleanup();
            if (batchTimeout) clearTimeout(batchTimeout);
            if (needsPods) {
                window.k8s.stopWatchPods();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clusterName, selectedNamespaces, activeView]); // Performance: Restart when switching to/from pods/overview

    // Deployment Watcher Effect - Separate to avoid unnecessary restarts
    useEffect(() => {
        let depCleanup: (() => void) | undefined;
        let depBatchTimeout: ReturnType<typeof setTimeout> | null = null;
        const pendingDepUpdates = new Map<string, { type: string; deployment: any }>();
        const needsDeployments = activeView === 'overview' || activeView === 'deployments';

        if (needsDeployments) {
            const nsToWatch = selectedNamespaces;
            window.k8s.watchDeployments(clusterName, nsToWatch);

            const processDepBatch = () => {
                if (pendingDepUpdates.size === 0) {
                    depBatchTimeout = null;
                    return;
                }

                const updates = new Map(pendingDepUpdates);
                pendingDepUpdates.clear();
                depBatchTimeout = null;

                // Performance: Use startTransition to mark updates as non-urgent
                startTransition(() => {
                    setDeployments(prev => {
                        if (updates.size === 0) return prev;

                        const depMap = new Map(prev.map(d => [`${d.metadata.namespace}/${d.metadata.name}`, d]));

                        updates.forEach(({ type, deployment }) => {
                            const key = `${deployment.metadata.namespace}/${deployment.metadata.name}`;

                            const mappedDep = {
                                name: deployment.metadata.name,
                                namespace: deployment.metadata.namespace,
                                replicas: deployment.spec.replicas,
                                availableReplicas: deployment.status.availableReplicas || 0,
                                readyReplicas: deployment.status.readyReplicas || 0,
                                unavailableReplicas: deployment.status.unavailableReplicas || 0,
                                updatedReplicas: deployment.status.updatedReplicas || 0,
                                conditions: deployment.status.conditions,
                                age: deployment.metadata.creationTimestamp,
                                metadata: deployment.metadata,
                                spec: deployment.spec,
                                status: deployment.status
                            };

                            const isSelected = selectedNamespaces.includes('all') || selectedNamespaces.includes(mappedDep.namespace);

                            if (type === 'ADDED' || type === 'MODIFIED') {
                                if (isSelected) {
                                    depMap.set(key, mappedDep);
                                } else if (depMap.has(key)) {
                                    depMap.delete(key);
                                }
                            } else if (type === 'DELETED') {
                                depMap.delete(key);
                            }
                        });

                        return Array.from(depMap.values());
                    });
                });
            };

            depCleanup = window.k8s.onDeploymentChange((type, dep) => {
                const key = `${dep.metadata.namespace}/${dep.metadata.name}`;
                pendingDepUpdates.set(key, { type, deployment: dep });
                if (!depBatchTimeout) {
                    depBatchTimeout = setTimeout(processDepBatch, 650);
                }
            });
        }

        return () => {
            // Performance: Clean up watchers when view changes or component unmounts
            if (depCleanup) depCleanup();
            if (depBatchTimeout) clearTimeout(depBatchTimeout);
            if (needsDeployments) {
                window.k8s.stopWatchDeployments();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clusterName, selectedNamespaces, activeView]); // Performance: Restart when switching to/from deployments/overview

    // Node Watcher Effect - Separate to avoid unnecessary restarts
    useEffect(() => {
        let nodeCleanup: (() => void) | undefined;
        let nodeBatchTimeout: ReturnType<typeof setTimeout> | null = null;
        const pendingNodeUpdates = new Map<string, { type: string; node: any }>();
        const needsNodes = activeView === 'nodes';

        if (needsNodes) {
            window.k8s.watchNodes(clusterName);

            const processNodeBatch = () => {
                if (pendingNodeUpdates.size === 0) {
                    nodeBatchTimeout = null;
                    return;
                }

                const updates = new Map(pendingNodeUpdates);
                pendingNodeUpdates.clear();
                nodeBatchTimeout = null;

                // Performance: Use startTransition to mark updates as non-urgent
                startTransition(() => {
                    setNodes(prev => {
                        if (updates.size === 0) return prev;

                        const nodeMap = new Map(prev.map(n => [n.name, n]));

                        updates.forEach(({ type, node }) => {
                            const key = node.name;

                            if (type === 'ADDED' || type === 'MODIFIED') {
                                nodeMap.set(key, node);
                            } else if (type === 'DELETED') {
                                nodeMap.delete(key);
                            }
                        });

                        return Array.from(nodeMap.values());
                    });
                });
            };

            nodeCleanup = window.k8s.onNodeChange((type, node) => {
                const key = node.name;
                pendingNodeUpdates.set(key, { type, node });
                if (!nodeBatchTimeout) {
                    nodeBatchTimeout = setTimeout(processNodeBatch, 650);
                }
            });
        }

        return () => {
            // Performance: Clean up watchers when view changes or component unmounts
            if (nodeCleanup) nodeCleanup();
            if (nodeBatchTimeout) clearTimeout(nodeBatchTimeout);
            if (needsNodes) {
                window.k8s.stopWatchNodes();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clusterName, activeView]); // Performance: Restart when switching to/from nodes view

    // Config Resource Watcher Effect - Watch config resources when their view is active
    useEffect(() => {
        // Shape raw K8s API objects to match the flat format from initial load functions
        const shapeResource: Record<string, (raw: any) => any> = {
            // Workloads
            daemonsets: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                desired: r.status?.desiredNumberScheduled, current: r.status?.currentNumberScheduled,
                ready: r.status?.numberReady, available: r.status?.numberAvailable,
                age: r.metadata?.creationTimestamp, metadata: r.metadata, spec: r.spec, status: r.status
            }),
            statefulsets: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                replicas: r.spec?.replicas, ready: r.status?.readyReplicas || 0,
                current: r.status?.currentReplicas || 0, age: r.metadata?.creationTimestamp,
                items: r.metadata, spec: r.spec, status: r.status
            }),
            replicasets: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                desired: r.spec?.replicas, current: r.status?.replicas,
                ready: r.status?.readyReplicas, metadata: r.metadata, spec: r.spec
            }),
            jobs: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                completions: r.spec?.completions, parallelism: r.spec?.parallelism,
                succeeded: r.status?.succeeded || 0, active: r.status?.active || 0,
                failed: r.status?.failed || 0, startTime: r.status?.startTime,
                completionTime: r.status?.completionTime, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, spec: r.spec, status: r.status
            }),
            cronjobs: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                schedule: r.spec?.schedule, suspend: r.spec?.suspend,
                active: r.status?.active?.length || 0, lastSchedule: r.status?.lastScheduleTime,
                lastScheduleTime: r.status?.lastScheduleTime, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, spec: r.spec, status: r.status
            }),
            // Network
            services: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                type: r.spec?.type, clusterIP: r.spec?.clusterIP,
                ports: r.spec?.ports?.map((p: any) => `${p.port}:${p.targetPort}/${p.protocol}`).join(', '),
                age: r.metadata?.creationTimestamp, metadata: r.metadata, spec: r.spec
            }),
            endpointslices: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                addressType: r.addressType,
                ports: r.ports?.map((p: any) => `${p.name || ''}:${p.port}/${p.protocol}`).join(', '),
                endpoints: r.endpoints?.length || 0, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, scope: r.endpoints, portsRaw: r.ports
            }),
            endpoints: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                subsets: r.subsets?.length || 0, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, subsetsRaw: r.subsets
            }),
            ingresses: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                class: r.spec?.ingressClassName,
                hosts: r.spec?.rules?.map((rule: any) => rule.host).join(', '),
                address: r.status?.loadBalancer?.ingress?.map((i: any) => i.ip || i.hostname).join(', '),
                age: r.metadata?.creationTimestamp, metadata: r.metadata, spec: r.spec, status: r.status
            }),
            ingressclasses: (r) => ({
                name: r.metadata?.name, controller: r.spec?.controller,
                apiGroup: r.spec?.parameters?.apiGroup, kind: r.spec?.parameters?.kind,
                age: r.metadata?.creationTimestamp, metadata: r.metadata, spec: r.spec
            }),
            networkpolicies: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                podSelector: r.spec?.podSelector?.matchLabels ? JSON.stringify(r.spec.podSelector.matchLabels) : '',
                policyTypes: r.spec?.policyTypes?.join(', '),
                age: r.metadata?.creationTimestamp, metadata: r.metadata, spec: r.spec
            }),
            // Storage
            persistentvolumeclaims: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                status: r.status?.phase, volume: r.spec?.volumeName,
                capacity: r.status?.capacity?.storage, accessModes: r.spec?.accessModes?.join(', '),
                storageClass: r.spec?.storageClassName, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, spec: r.spec, statusRaw: r.status
            }),
            persistentvolumes: (r) => ({
                name: r.metadata?.name, capacity: r.spec?.capacity?.storage,
                accessModes: r.spec?.accessModes?.join(', '),
                reclaimPolicy: r.spec?.persistentVolumeReclaimPolicy,
                status: r.status?.phase,
                claim: r.spec?.claimRef ? `${r.spec.claimRef.namespace}/${r.spec.claimRef.name}` : '',
                storageClass: r.spec?.storageClassName, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, spec: r.spec, statusRaw: r.status
            }),
            storageclasses: (r) => ({
                name: r.metadata?.name, provisioner: r.provisioner,
                reclaimPolicy: r.reclaimPolicy, volumeBindingMode: r.volumeBindingMode,
                age: r.metadata?.creationTimestamp, metadata: r.metadata, parameters: r.parameters
            }),
            // Config
            configmaps: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                data: Object.keys(r.data || {}).length, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, dataRaw: r.data
            }),
            secrets: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                type: r.type, data: Object.keys(r.data || {}).length,
                age: r.metadata?.creationTimestamp, metadata: r.metadata
            }),
            horizontalpodautoscalers: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                reference: `${r.spec?.scaleTargetRef?.kind}/${r.spec?.scaleTargetRef?.name}`,
                minPods: r.spec?.minReplicas, maxPods: r.spec?.maxReplicas,
                replicas: r.status?.currentReplicas, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, spec: r.spec, status: r.status
            }),
            poddisruptionbudgets: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                minAvailable: r.spec?.minAvailable, maxUnavailable: r.spec?.maxUnavailable,
                allowed: r.status?.disruptionsAllowed, current: r.status?.currentHealthy,
                desired: r.status?.desiredHealthy, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, spec: r.spec, status: r.status
            }),
            mutatingwebhookconfigurations: (r) => ({
                name: r.metadata?.name, webhooks: r.webhooks?.length || 0,
                age: r.metadata?.creationTimestamp, metadata: r.metadata, webhooksRaw: r.webhooks
            }),
            validatingwebhookconfigurations: (r) => ({
                name: r.metadata?.name, webhooks: r.webhooks?.length || 0,
                age: r.metadata?.creationTimestamp, metadata: r.metadata, webhooksRaw: r.webhooks
            }),
            priorityclasses: (r) => ({
                name: r.metadata?.name, value: r.value, globalDefault: r.globalDefault,
                description: r.description, age: r.metadata?.creationTimestamp, metadata: r.metadata
            }),
            runtimeclasses: (r) => ({
                name: r.metadata?.name, handler: r.handler,
                age: r.metadata?.creationTimestamp, metadata: r.metadata
            }),
            // Access Control
            clusterroles: (r) => ({
                name: r.metadata?.name, age: r.metadata?.creationTimestamp,
                metadata: r.metadata, rules: r.rules
            }),
            clusterrolebindings: (r) => ({
                name: r.metadata?.name, age: r.metadata?.creationTimestamp
            }),
            roles: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                age: r.metadata?.creationTimestamp
            }),
            rolebindings: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                age: r.metadata?.creationTimestamp
            }),
            serviceaccounts: (r) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                age: r.metadata?.creationTimestamp, secrets: r.secrets?.length || 0
            }),
        };

        // Helper for namespaced API paths
        const nsPath = (base: string, resource: string) => (ns: string[]) =>
            ns.includes('all') ? `${base}/${resource}` : `${base}/namespaces/${ns[0]}/${resource}`;

        // Map of view names to their API watch paths and state setters
        const RESOURCE_WATCH_MAP: Record<string, { apiPath: (ns: string[]) => string; setter: (fn: (prev: any[]) => any[]) => void }> = {
            // Workloads (pods, deployments, nodes have dedicated watchers — skip them)
            daemonsets: { apiPath: nsPath('/apis/apps/v1', 'daemonsets'), setter: setDaemonSets },
            statefulsets: { apiPath: nsPath('/apis/apps/v1', 'statefulsets'), setter: setStatefulSets },
            replicasets: { apiPath: nsPath('/apis/apps/v1', 'replicasets'), setter: setReplicaSets },
            jobs: { apiPath: nsPath('/apis/batch/v1', 'jobs'), setter: setJobs },
            cronjobs: { apiPath: nsPath('/apis/batch/v1', 'cronjobs'), setter: setCronJobs },
            // Network
            services: { apiPath: nsPath('/api/v1', 'services'), setter: setServices },
            endpointslices: { apiPath: nsPath('/apis/discovery.k8s.io/v1', 'endpointslices'), setter: setEndpointSlices },
            endpoints: { apiPath: nsPath('/api/v1', 'endpoints'), setter: setEndpoints },
            ingresses: { apiPath: nsPath('/apis/networking.k8s.io/v1', 'ingresses'), setter: setIngresses },
            ingressclasses: { apiPath: () => '/apis/networking.k8s.io/v1/ingressclasses', setter: setIngressClasses },
            networkpolicies: { apiPath: nsPath('/apis/networking.k8s.io/v1', 'networkpolicies'), setter: setNetworkPolicies },
            // Storage
            persistentvolumeclaims: { apiPath: nsPath('/api/v1', 'persistentvolumeclaims'), setter: setPvcs },
            persistentvolumes: { apiPath: () => '/api/v1/persistentvolumes', setter: setPvs },
            storageclasses: { apiPath: () => '/apis/storage.k8s.io/v1/storageclasses', setter: setStorageClasses },
            // Config
            configmaps: { apiPath: nsPath('/api/v1', 'configmaps'), setter: setConfigMaps },
            secrets: { apiPath: nsPath('/api/v1', 'secrets'), setter: setSecrets },
            horizontalpodautoscalers: { apiPath: nsPath('/apis/autoscaling/v2', 'horizontalpodautoscalers'), setter: setHorizontalPodAutoscalers },
            poddisruptionbudgets: { apiPath: nsPath('/apis/policy/v1', 'poddisruptionbudgets'), setter: setPodDisruptionBudgets },
            mutatingwebhookconfigurations: { apiPath: () => '/apis/admissionregistration.k8s.io/v1/mutatingwebhookconfigurations', setter: setMutatingWebhookConfigurations },
            validatingwebhookconfigurations: { apiPath: () => '/apis/admissionregistration.k8s.io/v1/validatingwebhookconfigurations', setter: setValidatingWebhookConfigurations },
            priorityclasses: { apiPath: () => '/apis/scheduling.k8s.io/v1/priorityclasses', setter: setPriorityClasses },
            runtimeclasses: { apiPath: () => '/apis/node.k8s.io/v1/runtimeclasses', setter: setRuntimeClasses },
            // Access Control
            clusterroles: { apiPath: () => '/apis/rbac.authorization.k8s.io/v1/clusterroles', setter: setClusterRoles },
            clusterrolebindings: { apiPath: () => '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings', setter: setClusterRoleBindings },
            roles: { apiPath: nsPath('/apis/rbac.authorization.k8s.io/v1', 'roles'), setter: setRoles },
            rolebindings: { apiPath: nsPath('/apis/rbac.authorization.k8s.io/v1', 'rolebindings'), setter: setRoleBindings },
            serviceaccounts: { apiPath: nsPath('/api/v1', 'serviceaccounts'), setter: setServiceAccounts },
        };

        // Check for CRD views: crd/{group}/{version}/{plural}
        let watchKey = activeView;
        let config = RESOURCE_WATCH_MAP[activeView];
        let shape = shapeResource[activeView];

        if (!config && isCrdView && crdParams.length >= 4) {
            const [, group, version, plural] = crdParams;
            const crdApiPath = `/apis/${group}/${version}/${plural}`;
            config = { apiPath: () => crdApiPath, setter: setCustomObjects };
            // CRD objects get the same shape as getCustomObjects: spread raw + flatten name/namespace/age
            shape = (r: any) => ({
                name: r.metadata?.name, namespace: r.metadata?.namespace,
                age: r.metadata?.creationTimestamp, ...r
            });
            watchKey = activeView; // Use full crd/group/version/plural as watch key
        }

        if (!config) return;

        const nsFilter = selectedNamespaces.length === 0 ? ['all'] : selectedNamespaces;
        const apiPath = config.apiPath(nsFilter);
        let genericCleanup: (() => void) | undefined;
        let batchTimeout: ReturnType<typeof setTimeout> | null = null;
        const pendingUpdates = new Map<string, { type: string; resource: any }>();

        window.k8s.watchGenericResource(clusterName, watchKey, apiPath);

        const processBatch = () => {
            if (pendingUpdates.size === 0) {
                batchTimeout = null;
                return;
            }

            const updates = new Map(pendingUpdates);
            pendingUpdates.clear();
            batchTimeout = null;

            startTransition(() => {
                config.setter(prev => {
                    if (updates.size === 0) return prev;

                    const resourceMap = new Map(prev.map((r: any) => {
                        const key = r.namespace
                            ? `${r.namespace}/${r.name}`
                            : r.name;
                        return [key, r];
                    }));

                    updates.forEach(({ type, resource }) => {
                        const shaped = shape ? shape(resource) : resource;
                        const key = shaped.namespace
                            ? `${shaped.namespace}/${shaped.name}`
                            : shaped.name;

                        if (type === 'ADDED' || type === 'MODIFIED') {
                            resourceMap.set(key, shaped);
                        } else if (type === 'DELETED') {
                            resourceMap.delete(key);
                        }
                    });

                    return Array.from(resourceMap.values());
                });
            });
        };

        genericCleanup = window.k8s.onGenericResourceChange((resourceType, type, resource) => {
            if (resourceType !== watchKey) return;
            const key = resource.metadata?.namespace
                ? `${resource.metadata.namespace}/${resource.metadata.name}`
                : resource.metadata?.name;
            pendingUpdates.set(key, { type, resource });
            if (!batchTimeout) {
                batchTimeout = setTimeout(processBatch, 650);
            }
        });

        return () => {
            if (genericCleanup) genericCleanup();
            if (batchTimeout) clearTimeout(batchTimeout);
            window.k8s.stopWatchGenericResource(watchKey);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clusterName, selectedNamespaces, activeView]);

    // Pod Metrics Refresh Effect - Refresh metrics every 30 seconds when on pods view
    useEffect(() => {
        if (activeView !== 'pods') {
            setPodMetrics({});
            return;
        }

        const refreshMetrics = () => {
            window.k8s.getPodMetrics(clusterName, selectedNamespaces).then(metrics => {
                setPodMetrics(metrics);
            }).catch(() => {
                // Metrics server may not be installed, silently ignore
            });
        };

        // Refresh every 30 seconds
        const interval = setInterval(refreshMetrics, 30000);

        return () => clearInterval(interval);
    }, [clusterName, selectedNamespaces, activeView]);

    // Load Data based on View and Selection
    const loadResources = async () => {
        if (!clusterName) return;

        // Performance: Generate cache key based on view and namespace selection
        const cacheKey = `${activeView}-${selectedNamespaces.join(',')}`;
        const cachedData = getCachedData(cacheKey);

        // Performance: Only show loading if we have no data AND no cache
        const hasData = getCurrentViewData();
        if (!hasData && !cachedData) {
            setLoading(true);
        }

        try {
            const nsFilter = selectedNamespaces;
            const promises: Promise<any>[] = [];

            // Overview needs Pods (pie chart), Deployments (bar chart), and Events
            if (activeView === 'overview') {
                promises.push(window.k8s.getPods(clusterName, nsFilter).then(data => {
                    setPods(data);
                    setCachedData(`pods-${nsFilter.join(',')}`, data);
                }));
                promises.push(window.k8s.getDeployments(clusterName, nsFilter).then(data => {
                    setDeployments(data);
                    setCachedData(`deployments-${nsFilter.join(',')}`, data);
                }));
                promises.push(window.k8s.getEvents(clusterName, nsFilter).then(data => {
                    setEvents(data);
                    setCachedData(`events-${nsFilter.join(',')}`, data);
                }));
            }

            if (activeView === 'deployments') {
                promises.push(window.k8s.getDeployments(clusterName, nsFilter).then(data => {
                    setDeployments(data);
                    setCachedData(cacheKey, data);
                }));
            }

            // Individual Views
            if (activeView === 'nodes') {
                promises.push(window.k8s.getNodes(clusterName).then(data => {
                    setNodes(data);
                    setCachedData(cacheKey, data);
                }));
            }

            if (activeView === 'pods') {
                promises.push(window.k8s.getPods(clusterName, nsFilter).then(data => {
                    setPods(data);
                    setCachedData(`pods-${nsFilter.join(',')}`, data);
                }));
                // Fetch pod metrics (non-blocking, don't fail if metrics-server unavailable)
                window.k8s.getPodMetrics(clusterName, nsFilter).then(metrics => {
                    setPodMetrics(metrics);
                }).catch(() => {
                    // Metrics server may not be installed, silently ignore
                    setPodMetrics({});
                });
                // Performance: Cache nodes too, they don't change often
                const nodesCacheKey = 'nodes';
                const cachedNodes = getCachedData(nodesCacheKey);
                if (!cachedNodes || nodes.length === 0) {
                    promises.push(window.k8s.getNodes(clusterName).then(data => {
                        setNodes(data);
                        setCachedData(nodesCacheKey, data);
                    }));
                }
            }
            if (activeView === 'replicasets') {
                promises.push(window.k8s.getReplicaSets(clusterName, nsFilter).then(data => {
                    setReplicaSets(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'services') {
                promises.push(window.k8s.getServices(clusterName, nsFilter).then(data => {
                    setServices(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'clusterrolebindings') {
                promises.push(window.k8s.getClusterRoleBindings(clusterName).then(data => {
                    setClusterRoleBindings(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'clusterroles') {
                promises.push(window.k8s.getClusterRoles(clusterName).then(data => {
                    setClusterRoles(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'rolebindings') {
                promises.push(window.k8s.getRoleBindings(clusterName, nsFilter).then(data => {
                    setRoleBindings(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'serviceaccounts') {
                promises.push(window.k8s.getServiceAccounts(clusterName, nsFilter).then(data => {
                    setServiceAccounts(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'roles') {
                promises.push(window.k8s.getRoles(clusterName, nsFilter).then(data => {
                    setRoles(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'daemonsets') {
                promises.push(window.k8s.getDaemonSets(clusterName, nsFilter).then(data => {
                    setDaemonSets(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'statefulsets') {
                promises.push(window.k8s.getStatefulSets(clusterName, nsFilter).then(data => {
                    setStatefulSets(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'jobs') {
                promises.push(window.k8s.getJobs(clusterName, nsFilter).then(data => {
                    setJobs(data);
                    setCachedData(cacheKey, data);
                }));
            }
            if (activeView === 'cronjobs') {
                promises.push(window.k8s.getCronJobs(clusterName, nsFilter).then(data => {
                    setCronJobs(data);
                    setCachedData(cacheKey, data);
                }));
            }

            // Handle CRD Definitions List
            if (activeView === 'crd-definitions') {
                promises.push(window.k8s.getCRDs(clusterName).then(data => {
                    setCrdDefinitions(data);
                    setCachedData(cacheKey, data);
                }));
            }

            // Handle Dynamic CRD View
            if (isCrdView && crdParams.length >= 4) {
                const [_, group, version, plural] = crdParams;
                setCurrentCrdKind(plural);
                promises.push(window.k8s.getCustomObjects(clusterName, group, version, plural).then(data => {
                    setCustomObjects(data);
                    setCachedData(cacheKey, data);
                }));
            }

            // Network
            if (activeView === 'endpointslices') {
                window.k8s.getEndpointSlices(clusterName, nsFilter).then(data => {
                    setEndpointSlices(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'endpoints') {
                window.k8s.getEndpoints(clusterName, nsFilter).then(data => {
                    setEndpoints(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'ingresses') {
                window.k8s.getIngresses(clusterName, nsFilter).then(data => {
                    setIngresses(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'ingressclasses') {
                window.k8s.getIngressClasses(clusterName).then(data => {
                    setIngressClasses(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'networkpolicies') {
                window.k8s.getNetworkPolicies(clusterName, nsFilter).then(data => {
                    setNetworkPolicies(data);
                    setCachedData(cacheKey, data);
                });
            }

            // Storage
            if (activeView === 'persistentvolumeclaims') {
                window.k8s.getPersistentVolumeClaims(clusterName, nsFilter).then(data => {
                    setPvcs(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'persistentvolumes') {
                window.k8s.getPersistentVolumes(clusterName).then(data => {
                    setPvs(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'storageclasses') {
                window.k8s.getStorageClasses(clusterName).then(data => {
                    setStorageClasses(data);
                    setCachedData(cacheKey, data);
                });
            }

            // Config
            if (activeView === 'configmaps') {
                window.k8s.getConfigMaps(clusterName, nsFilter).then(data => {
                    setConfigMaps(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'secrets') {
                window.k8s.getSecrets(clusterName, nsFilter).then(data => {
                    setSecrets(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'horizontalpodautoscalers') {
                window.k8s.getHorizontalPodAutoscalers(clusterName, nsFilter).then(data => {
                    setHorizontalPodAutoscalers(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'poddisruptionbudgets') {
                window.k8s.getPodDisruptionBudgets(clusterName, nsFilter).then(data => {
                    setPodDisruptionBudgets(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'mutatingwebhookconfigurations') {
                window.k8s.getMutatingWebhookConfigurations(clusterName).then(data => {
                    setMutatingWebhookConfigurations(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'validatingwebhookconfigurations') {
                window.k8s.getValidatingWebhookConfigurations(clusterName).then(data => {
                    setValidatingWebhookConfigurations(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'priorityclasses') {
                window.k8s.getPriorityClasses(clusterName).then(data => {
                    setPriorityClasses(data);
                    setCachedData(cacheKey, data);
                });
            }
            if (activeView === 'runtimeclasses') {
                window.k8s.getRuntimeClasses(clusterName).then(data => {
                    setRuntimeClasses(data);
                    setCachedData(cacheKey, data);
                });
            }

            await Promise.all(promises);

        } catch (e) {
            console.error("Failed to load resources", e);
        } finally {
            // Only turn off loading if we are still on the same view that started the load
            if (activeViewRef.current === activeView) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        loadResources();
    }, [clusterName, selectedNamespaces, activeView]);

    const handleResourceClick = async (resource: any, type: 'deployment' | 'pod' | 'replicaset' | 'service' | 'clusterrole' | 'clusterrolebinding' | 'rolebinding' | 'serviceaccount' | 'role' | 'node' | 'crd-definition' | 'custom-resource' | 'daemonset' | 'statefulset' | 'job' | 'cronjob' | 'endpointslice' | 'endpoint' | 'ingress' | 'ingressclass' | 'networkpolicy' | 'persistentvolumeclaim' | 'persistentvolume' | 'storageclass' | 'configmap' | 'secret' | 'horizontalpodautoscaler' | 'poddisruptionbudget' | 'mutatingwebhookconfiguration' | 'validatingwebhookconfiguration' | 'priorityclass' | 'runtimeclass' | 'namespace' | 'ec2instance' | 'other') => {
        setSelectedResource({ ...resource, type });
        setIsDrawerOpen(true);
        setDetailedResource(null); // Clear previous details while loading
        setDrawerTab('details'); // Reset tab on new selection

        // Only fetch details for types we have specific detail fetching logic for
        // Config resources will use generic details component
        if (['deployment', 'service', 'pod', 'replicaset', 'clusterrole', 'clusterrolebinding', 'rolebinding', 'serviceaccount', 'role', 'node', 'crd-definition', 'custom-resource', 'daemonset', 'statefulset', 'job', 'cronjob', 'endpointslice', 'endpoint', 'ingress', 'ingressclass', 'networkpolicy', 'persistentvolumeclaim', 'persistentvolume', 'storageclass', 'configmap', 'secret', 'horizontalpodautoscaler', 'poddisruptionbudget', 'mutatingwebhookconfiguration', 'validatingwebhookconfiguration', 'priorityclass', 'runtimeclass', 'namespace', 'ec2instance'].includes(type)) {
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
                } else if (type === 'ec2instance') {
                    // EC2 instance data is already in the resource object from AwsView
                    setDetailedResource(resource);
                }
                // For generic 'other' (CRDs), we might just show raw JSON or limited details if we don't have a specific parser
            } catch (err) {
                console.error("Error loading details", err);
                // Set error state so the drawer doesn't show a spinner forever
                setDetailedResource({ error: `Failed to load details: ${err instanceof Error ? err.message : 'Unknown error'}` });
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



    const handleNavigate = async (kind: string, name: string, namespace?: string) => {
        console.log('handleNavigate called with:', kind, name, namespace);
        // Find the resource
        let resource;
        const lowerKind = kind.toLowerCase();

        // Use the explicitly passed namespace first, then fall back to the current resource's namespace
        const currentNamespace = namespace || selectedResource?.metadata?.namespace || selectedResource?.namespace;

        // Check if we have the resource in state
        if (lowerKind === 'replicaset') {
            resource = replicaSets.find(r => r.name === name && (!currentNamespace || r.namespace === currentNamespace));
        } else if (lowerKind === 'deployment') {
            resource = deployments.find(d => d.metadata.name === name && (!currentNamespace || d.metadata.namespace === currentNamespace));
        } else if (lowerKind === 'pod') {
            const pod = pods.find(p => p.metadata.name === name && (!currentNamespace || p.metadata.namespace === currentNamespace));
            if (pod) {
                // Normalize pod structure to have flat namespace and name properties
                resource = {
                    ...pod,
                    namespace: pod.metadata.namespace,
                    name: pod.metadata.name,
                    type: 'pod'
                };
            }
        } else if (lowerKind === 'node') {
            const node = nodes.find(n => n.metadata?.name === name);
            if (node) {
                // Normalize node structure
                resource = {
                    ...node,
                    name: node.metadata.name,
                    type: 'node'
                };
            }
        }

        // If not found in state, try to fetch it directly
        if (!resource) {
            console.log(`Resource ${kind}/${name} not found in state, fetching directly...`);
            try {
                const namespace = currentNamespace || 'default'; // Fallback
                if (lowerKind === 'replicaset') {
                    const fetched = await window.k8s.getReplicaSet(clusterName, namespace, name);
                    if (fetched) {
                        resource = {
                            ...fetched,
                            name: fetched.metadata?.name || name,
                            namespace: fetched.metadata?.namespace || namespace,
                            type: 'replicaset'
                        };
                    }
                } else if (lowerKind === 'deployment') {
                    const fetched = await window.k8s.getDeployment(clusterName, namespace, name);
                    if (fetched) {
                        resource = {
                            ...fetched,
                            name: fetched.metadata?.name || name,
                            namespace: fetched.metadata?.namespace || namespace,
                            type: 'deployment'
                        };
                    }
                } else if (lowerKind === 'pod') {
                    const fetched = await window.k8s.getPod(clusterName, namespace, name);
                    if (fetched) {
                        resource = {
                            ...fetched,
                            namespace: fetched.metadata?.namespace || namespace,
                            name: fetched.metadata?.name || name,
                            type: 'pod'
                        };
                    }
                } else if (lowerKind === 'node') {
                    const fetched = await window.k8s.getNode(clusterName, name);
                    if (fetched) {
                        resource = {
                            ...fetched,
                            name: fetched.metadata.name,
                            type: 'node'
                        };
                    }
                }
            } catch (err) {
                console.error(`Failed to fetch ${kind}/${name}`, err);
            }
        }

        console.log('Found resource:', resource);

        if (resource) {
            // Navigate within the drawer - call handleResourceClick to load new details
            handleResourceClick(resource, lowerKind as any);
        } else {
            console.warn(`Could not find resource ${kind}/${name} to navigate to.`);
            // Show error in drawer instead of leaving it in a broken state
            setDetailedResource({ error: `Could not find ${kind}/${name}` });
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

    const handleTriggerCronJob = async () => {
        if (!selectedResource || selectedResource.type !== 'cronjob') return;

        try {
            const result = await window.k8s.triggerCronJob(clusterName, selectedResource.namespace, selectedResource.name);
            if (result.success) {
                alert(`CronJob triggered successfully! Created job: ${result.jobName}`);
                // Optionally refresh the view or navigate to the job
            }
        } catch (e: any) {
            console.error("Failed to trigger CronJob", e);
            alert(`Failed to trigger CronJob: ${e.message || 'Unknown error'}`);
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
        <div className="flex flex-col h-full relative">
            {/* Top Bar */}
            <DashboardHeader
                clusterName={clusterName}
                activeView={activeView}
                currentCrdKind={currentCrdKind}
                isCrdView={isCrdView}
                resourceCount={resourceCount}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                namespaces={namespaces}
                selectedNamespaces={selectedNamespaces}
                onNamespaceChange={setSelectedNamespaces}
                podViewMode={podViewMode}
                onPodViewModeChange={setPodViewMode}
            />

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6 pb-4">
                <DashboardContent
                    activeView={activeView}
                    isCrdView={isCrdView}
                    currentCrdKind={currentCrdKind}
                    pods={pods}
                    deployments={deployments}
                    replicaSets={replicaSets}
                    services={services}
                    nodes={nodes}
                    events={events}
                    namespacesList={namespacesList}
                    crdDefinitions={crdDefinitions}
                    customObjects={customObjects}
                    daemonSets={daemonSets}
                    statefulSets={statefulSets}
                    jobs={jobs}
                    cronJobs={cronJobs}
                    configMaps={configMaps}
                    secrets={secrets}
                    pvcs={pvcs}
                    pvs={pvs}
                    storageClasses={storageClasses}
                    ingresses={ingresses}
                    ingressClasses={ingressClasses}
                    endpointSlices={endpointSlices}
                    endpoints={endpoints}
                    networkPolicies={networkPolicies}
                    serviceAccounts={serviceAccounts}
                    roles={roles}
                    roleBindings={roleBindings}
                    clusterRoles={clusterRoles}
                    clusterRoleBindings={clusterRoleBindings}
                    horizontalPodAutoscalers={horizontalPodAutoscalers}
                    podDisruptionBudgets={podDisruptionBudgets}
                    mutatingWebhookConfigurations={mutatingWebhookConfigurations}
                    validatingWebhookConfigurations={validatingWebhookConfigurations}
                    priorityClasses={priorityClasses}
                    runtimeClasses={runtimeClasses}
                    podMetrics={podMetrics}
                    loading={loading}
                    podViewMode={podViewMode}
                    sortConfig={sortConfig}
                    searchQuery={debouncedSearchQuery}
                    clusterName={clusterName}
                    selectedNamespaces={selectedNamespaces}
                    onSort={handleSort}
                    onResourceClick={handleResourceClick}
                    onNavigate={onNavigate}
                    onExec={onExec}
                    onOpenLogs={onOpenLogs}
                    getSortedData={getSortedData}
                    summariesEnabled={summariesEnabled}
                />
            </div>
            < Drawer
                isOpen={isDrawerOpen}
                onClose={() => {
                    if (!isScaleModalOpen) {
                        setIsDrawerOpen(false);
                    }
                }}
                title={selectedResource?.name || 'Details'}
                headerActions={
                    <div className="flex items-center gap-2">
                        {onOpenYaml && (
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
                <ErrorBoundary name="DrawerDetails" resetKey={`${selectedResource?.name}-${selectedResource?.type}-${selectedResource?.namespace}`}>
                    {detailedResource ? (
                        detailedResource.error ? (
                            <div className="p-4 text-red-400 bg-red-900/20 rounded border border-red-900/30">
                                <p className="text-sm">{detailedResource.error}</p>
                            </div>
                        ) : (
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
                                        onOpenYaml={onOpenYaml}
                                        onTriggerCronJob={handleTriggerCronJob}
                                    />
                                )}
                            </>
                        )
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
