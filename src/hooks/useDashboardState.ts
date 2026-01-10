import { useState, useRef } from 'react';

/**
 * Custom hook for managing Dashboard state
 * Extracts all state variables and cache logic from Dashboard component
 */

export interface DashboardState {
    // Resource State
    deployments: any[];
    pods: any[];
    replicaSets: any[];
    services: any[];
    clusterRoleBindings: any[];
    clusterRoles: any[];
    roleBindings: any[];
    events: any[];
    roles: any[];
    serviceAccounts: any[];
    daemonSets: any[];
    statefulSets: any[];
    jobs: any[];
    cronJobs: any[];

    // Network State
    endpointSlices: any[];
    endpoints: any[];
    ingresses: any[];
    ingressClasses: any[];
    networkPolicies: any[];

    // Storage State
    pvcs: any[];
    pvs: any[];
    storageClasses: any[];

    // Config State
    configMaps: any[];
    secrets: any[];
    horizontalPodAutoscalers: any[];
    podDisruptionBudgets: any[];
    mutatingWebhookConfigurations: any[];
    validatingWebhookConfigurations: any[];
    priorityClasses: any[];
    runtimeClasses: any[];

    // Other State
    nodes: any[];
    customObjects: any[];
    currentCrdKind: string;
    crdDefinitions: any[];
    namespacesList: any[];
    namespaces: string[];
    selectedNamespaces: string[];

    // UI State
    loading: boolean;
    selectedResource: any;
    detailedResource: any;
    isDrawerOpen: boolean;
    isScaleModalOpen: boolean;
    drawerTab: 'details' | 'topology';
    podViewMode: 'list' | 'visual';
    sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
    searchQuery: string;
    debouncedSearchQuery: string;
}

export interface DashboardStateSetters {
    setDeployments: React.Dispatch<React.SetStateAction<any[]>>;
    setPods: React.Dispatch<React.SetStateAction<any[]>>;
    setReplicaSets: React.Dispatch<React.SetStateAction<any[]>>;
    setServices: React.Dispatch<React.SetStateAction<any[]>>;
    setClusterRoleBindings: React.Dispatch<React.SetStateAction<any[]>>;
    setClusterRoles: React.Dispatch<React.SetStateAction<any[]>>;
    setRoleBindings: React.Dispatch<React.SetStateAction<any[]>>;
    setEvents: React.Dispatch<React.SetStateAction<any[]>>;
    setRoles: React.Dispatch<React.SetStateAction<any[]>>;
    setServiceAccounts: React.Dispatch<React.SetStateAction<any[]>>;
    setDaemonSets: React.Dispatch<React.SetStateAction<any[]>>;
    setStatefulSets: React.Dispatch<React.SetStateAction<any[]>>;
    setJobs: React.Dispatch<React.SetStateAction<any[]>>;
    setCronJobs: React.Dispatch<React.SetStateAction<any[]>>;
    setEndpointSlices: React.Dispatch<React.SetStateAction<any[]>>;
    setEndpoints: React.Dispatch<React.SetStateAction<any[]>>;
    setIngresses: React.Dispatch<React.SetStateAction<any[]>>;
    setIngressClasses: React.Dispatch<React.SetStateAction<any[]>>;
    setNetworkPolicies: React.Dispatch<React.SetStateAction<any[]>>;
    setPvcs: React.Dispatch<React.SetStateAction<any[]>>;
    setPvs: React.Dispatch<React.SetStateAction<any[]>>;
    setStorageClasses: React.Dispatch<React.SetStateAction<any[]>>;
    setConfigMaps: React.Dispatch<React.SetStateAction<any[]>>;
    setSecrets: React.Dispatch<React.SetStateAction<any[]>>;
    setHorizontalPodAutoscalers: React.Dispatch<React.SetStateAction<any[]>>;
    setPodDisruptionBudgets: React.Dispatch<React.SetStateAction<any[]>>;
    setMutatingWebhookConfigurations: React.Dispatch<React.SetStateAction<any[]>>;
    setValidatingWebhookConfigurations: React.Dispatch<React.SetStateAction<any[]>>;
    setPriorityClasses: React.Dispatch<React.SetStateAction<any[]>>;
    setRuntimeClasses: React.Dispatch<React.SetStateAction<any[]>>;
    setNodes: React.Dispatch<React.SetStateAction<any[]>>;
    setCustomObjects: React.Dispatch<React.SetStateAction<any[]>>;
    setCurrentCrdKind: React.Dispatch<React.SetStateAction<string>>;
    setCrdDefinitions: React.Dispatch<React.SetStateAction<any[]>>;
    setNamespacesList: React.Dispatch<React.SetStateAction<any[]>>;
    setNamespaces: React.Dispatch<React.SetStateAction<string[]>>;
    setSelectedNamespaces: React.Dispatch<React.SetStateAction<string[]>>;
    setLoading: React.Dispatch<React.SetStateAction<boolean>>;
    setSelectedResource: React.Dispatch<React.SetStateAction<any>>;
    setDetailedResource: React.Dispatch<React.SetStateAction<any>>;
    setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsScaleModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setDrawerTab: React.Dispatch<React.SetStateAction<'details' | 'topology'>>;
    setPodViewMode: React.Dispatch<React.SetStateAction<'list' | 'visual'>>;
    setSortConfig: React.Dispatch<React.SetStateAction<{ key: string; direction: 'asc' | 'desc' } | null>>;
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
    setDebouncedSearchQuery: React.Dispatch<React.SetStateAction<string>>;
}

export interface CacheHelpers {
    resourceCacheRef: React.MutableRefObject<Map<string, { data: any[]; timestamp: number }>>;
    CACHE_TTL: number;
    getCachedData: (cacheKey: string) => any[] | null;
    setCachedData: (cacheKey: string, data: any[]) => void;
    getCurrentViewData: (activeView: string) => boolean;
}

export function useDashboardState() {
    // Resource State
    const [deployments, setDeployments] = useState<any[]>([]);
    const [pods, setPods] = useState<any[]>([]);
    const [replicaSets, setReplicaSets] = useState<any[]>([]);
    const [services, setServices] = useState<any[]>([]);
    const [clusterRoleBindings, setClusterRoleBindings] = useState<any[]>([]);
    const [clusterRoles, setClusterRoles] = useState<any[]>([]);
    const [roleBindings, setRoleBindings] = useState<any[]>([]);
    const [events, setEvents] = useState<any[]>([]);
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

    // Other State
    const [nodes, setNodes] = useState<any[]>([]);
    const [customObjects, setCustomObjects] = useState<any[]>([]);
    const [currentCrdKind, setCurrentCrdKind] = useState<string>('');
    const [crdDefinitions, setCrdDefinitions] = useState<any[]>([]);
    const [namespacesList, setNamespacesList] = useState<any[]>([]);
    const [namespaces, setNamespaces] = useState<string[]>([]);
    const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>(['all']);

    // UI State
    const [loading, setLoading] = useState(false);
    const [selectedResource, setSelectedResource] = useState<any>(null);
    const [detailedResource, setDetailedResource] = useState<any>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [isScaleModalOpen, setIsScaleModalOpen] = useState(false);
    const [drawerTab, setDrawerTab] = useState<'details' | 'topology'>('details');
    const [podViewMode, setPodViewMode] = useState<'list' | 'visual'>('list');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

    // Performance: Resource cache to prevent unnecessary refetches
    const resourceCacheRef = useRef<Map<string, { data: any[]; timestamp: number }>>(new Map());
    const CACHE_TTL = 30000; // 30 seconds

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

    // Performance: Helper to get current view data for cache check
    const getCurrentViewData = (activeView: string) => {
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

    const state: DashboardState = {
        deployments,
        pods,
        replicaSets,
        services,
        clusterRoleBindings,
        clusterRoles,
        roleBindings,
        events,
        roles,
        serviceAccounts,
        daemonSets,
        statefulSets,
        jobs,
        cronJobs,
        endpointSlices,
        endpoints,
        ingresses,
        ingressClasses,
        networkPolicies,
        pvcs,
        pvs,
        storageClasses,
        configMaps,
        secrets,
        horizontalPodAutoscalers,
        podDisruptionBudgets,
        mutatingWebhookConfigurations,
        validatingWebhookConfigurations,
        priorityClasses,
        runtimeClasses,
        nodes,
        customObjects,
        currentCrdKind,
        crdDefinitions,
        namespacesList,
        namespaces,
        selectedNamespaces,
        loading,
        selectedResource,
        detailedResource,
        isDrawerOpen,
        isScaleModalOpen,
        drawerTab,
        podViewMode,
        sortConfig,
        searchQuery,
        debouncedSearchQuery,
    };

    const setters: DashboardStateSetters = {
        setDeployments,
        setPods,
        setReplicaSets,
        setServices,
        setClusterRoleBindings,
        setClusterRoles,
        setRoleBindings,
        setEvents,
        setRoles,
        setServiceAccounts,
        setDaemonSets,
        setStatefulSets,
        setJobs,
        setCronJobs,
        setEndpointSlices,
        setEndpoints,
        setIngresses,
        setIngressClasses,
        setNetworkPolicies,
        setPvcs,
        setPvs,
        setStorageClasses,
        setConfigMaps,
        setSecrets,
        setHorizontalPodAutoscalers,
        setPodDisruptionBudgets,
        setMutatingWebhookConfigurations,
        setValidatingWebhookConfigurations,
        setPriorityClasses,
        setRuntimeClasses,
        setNodes,
        setCustomObjects,
        setCurrentCrdKind,
        setCrdDefinitions,
        setNamespacesList,
        setNamespaces,
        setSelectedNamespaces,
        setLoading,
        setSelectedResource,
        setDetailedResource,
        setIsDrawerOpen,
        setIsScaleModalOpen,
        setDrawerTab,
        setPodViewMode,
        setSortConfig,
        setSearchQuery,
        setDebouncedSearchQuery,
    };

    const cacheHelpers: CacheHelpers = {
        resourceCacheRef,
        CACHE_TTL,
        getCachedData,
        setCachedData,
        getCurrentViewData,
    };

    return {
        state,
        setters,
        cacheHelpers,
    };
}
