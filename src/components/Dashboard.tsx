import React, { useState, useEffect, useRef, useMemo, useTransition } from 'react';
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



    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // Performance: Memoize sorted data to prevent recalculation on every render
    const getSortedData = useMemo(() => {
        return (data: any[]) => {
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
    }, [sortConfig]);








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
                    loading={loading}
                    podViewMode={podViewMode}
                    sortConfig={sortConfig}
                    searchQuery={debouncedSearchQuery}
                    clusterName={clusterName}
                    selectedNamespaces={selectedNamespaces}
                    onSort={handleSort}
                    onResourceClick={handleResourceClick}
                    onNavigate={onNavigate}
                    getSortedData={getSortedData}
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
                                    onOpenYaml={onOpenYaml}
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
