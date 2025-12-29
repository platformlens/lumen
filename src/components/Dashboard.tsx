import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Layers,
  Network,
  PenTool,
  Square,
  Trash
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
import { StatusBadge } from './shared/StatusBadge';


interface DashboardProps {
    clusterName: string;
    activeView: string;
    onOpenLogs: (pod: any, containerName: string) => void;
    onNavigate?: (view: string) => void;
    onOpenYaml?: (deployment: any) => void;
}
  
export const Dashboard: React.FC<DashboardProps> = ({ clusterName, activeView, onOpenLogs, onNavigate, onOpenYaml }) => {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>(['all']);
  
  const [deployments, setDeployments] = useState<any[]>([]);
  const [pods, setPods] = useState<any[]>([]);
  const [replicaSets, setReplicaSets] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [clusterRoleBindings, setClusterRoleBindings] = useState<any[]>([]);
  const [roleBindings, setRoleBindings] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [, setLoading] = useState(false);
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

  // Handle CRD view parsing
  const isCrdView = activeView.startsWith('crd/');
  const crdParams = isCrdView ? activeView.split('/') : []; // ['crd', group, version, plural]
  
  // Selection State
  const [selectedResource, setSelectedResource] = useState<any>(null);
  const [detailedResource, setDetailedResource] = useState<any>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  // AI State
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isScaleModalOpen, setIsScaleModalOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'details' | 'topology'>('details');
  const [podViewMode, setPodViewMode] = useState<'list' | 'visual'>('list');
  
  // Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

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
      
      // Default string comparison
      const valA = a[sortConfig.key]?.toString().toLowerCase() || '';
      const valB = b[sortConfig.key]?.toString().toLowerCase() || '';
      
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Clear explanation when resource changes
  useEffect(() => {
    setExplanation(null);
    setIsExplaining(false);
  }, [selectedResource?.type, selectedResource?.namespace, selectedResource?.name]);


  // Load Namespaces
  useEffect(() => {
    window.k8s.getNamespaces(clusterName).then(setNamespaces).catch(console.error);
  }, [clusterName]);

  // Watcher Effect
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    if (activeView === 'overview' || activeView === 'pods') {
        const nsToWatch = selectedNamespaces;
        
        // Start watching
        window.k8s.watchPods(clusterName, nsToWatch);

        // Listen for changes
        cleanup = window.k8s.onPodChange((type, pod) => {
            console.log('Pod Change:', type, pod.name);
            setPods(prev => {
                if (type === 'ADDED' || type === 'MODIFIED') {
                    // Start of list or update existing? Usually Kubernetes returns lists in order but updates are specific.
                    // Check if exists
                    const idx = prev.findIndex(p => p.name === pod.name && p.namespace === pod.namespace);
                    if (idx >= 0) {
                        const newPods = [...prev];
                        newPods[idx] = { ...newPods[idx], ...pod }; // Merge to preserve any extra fields if any, though pod from event should be complete for list view
                        return newPods;
                    } else {
                        return [pod, ...prev]; // Add to top? Or sort?
                    }
                } else if (type === 'DELETED') {
                    return prev.filter(p => !(p.name === pod.name && p.namespace === pod.namespace));
                }
                return prev;
            });
        });
    }

    return () => {
        if (cleanup) cleanup();
        window.k8s.stopWatchPods();
    };
  }, [clusterName, selectedNamespaces, activeView]);

  // Load Data based on View and Selection
  const loadResources = async () => {
    if (!clusterName) return;

    try {
      setLoading(true);
      const nsFilter = selectedNamespaces;
      const promises: Promise<any>[] = [];

      // Overview needs Pods (pie chart), Deployments (bar chart), and Events
      if (activeView === 'overview') {
          promises.push(window.k8s.getPods(clusterName, nsFilter).then(setPods));
          promises.push(window.k8s.getDeployments(clusterName, nsFilter).then(setDeployments));
          promises.push(window.k8s.getEvents(clusterName, nsFilter).then(setEvents));
          // Pre-fetch nodes for visualizer if user clicks it, or just fetch on demand? 
          // Fetching Nodes is cheap. Let's include it or fetch on transition.
          // Better: check isPodVisualizerOpen in effect or here.
          // Since loadResources runs on activeView change, and isPodVisualizerOpen is local,
          // we need a separate effect or check.
          // Let's add it to the 'nodes' check or just always fetch if we are in overview to be safe?
          // No, let's add a specific check.
      }
      


      // Individual Views
      if (activeView === 'nodes') {
          promises.push(window.k8s.getNodes(clusterName).then(setNodes));
      }
      if (activeView === 'deployments') {
          promises.push(window.k8s.getDeployments(clusterName, nsFilter).then(setDeployments));
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

  const handleResourceClick = async (resource: any, type: 'deployment' | 'pod' | 'replicaset' | 'service' | 'clusterrolebinding' | 'rolebinding' | 'serviceaccount' | 'role' | 'node' | 'crd-definition' | 'custom-resource' | 'daemonset' | 'statefulset' | 'job' | 'cronjob' | 'endpointslice' | 'endpoint' | 'ingress' | 'ingressclass' | 'networkpolicy' | 'persistentvolumeclaim' | 'persistentvolume' | 'storageclass' | 'configmap' | 'secret' | 'horizontalpodautoscaler' | 'poddisruptionbudget' | 'mutatingwebhookconfiguration' | 'validatingwebhookconfiguration' | 'priorityclass' | 'runtimeclass' | 'other') => {
      setSelectedResource({ ...resource, type });
      setIsDrawerOpen(true);
      setDetailedResource(null); // Clear previous details while loading
      setDrawerTab('details'); // Reset tab on new selection

      // Only fetch details for types we have specific detail fetching logic for
      // Config resources will use generic details component
      if (['deployment', 'service', 'pod', 'replicaset', 'clusterrolebinding', 'rolebinding', 'serviceaccount', 'role', 'node', 'crd-definition', 'custom-resource', 'daemonset', 'statefulset', 'job', 'cronjob', 'endpointslice', 'endpoint', 'ingress', 'ingressclass', 'networkpolicy', 'persistentvolumeclaim', 'persistentvolume', 'storageclass', 'configmap', 'secret', 'horizontalpodautoscaler', 'poddisruptionbudget', 'mutatingwebhookconfiguration', 'validatingwebhookconfiguration', 'priorityclass', 'runtimeclass'].includes(type)) {
          try {
            if (type === 'deployment') {
                const details = await window.k8s.getDeployment(clusterName, resource.namespace, resource.name);
                setDetailedResource(details);
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
    setIsExplaining(true);
    try {
        const model = localStorage.getItem('k8ptain_model') || 'gemini-2.5-flash';
        const result = await window.k8s.explainResource(target, model);
        setExplanation(result);
    } catch (e) {
        setExplanation("Failed to generate explanation. Please check your API key.");
        console.error(e);
    } finally {
        setIsExplaining(false);
    }
  }

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

  return (
    <div className="flex flex-col h-full relative">
      {/* Top Bar */}
      <div className="flex-none p-6 border border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between rounded-2xl">
            <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
                    <Layers className="text-white" size={20} />
                 </div>
                 <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight capitalize">{isCrdView ? currentCrdKind : activeView}</h1>
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10">
                            <Network size={12} className="text-blue-400" /> 
                            {clusterName}
                        </span>
                    </div>
                 </div>
            </div>

            <div className="flex items-center gap-3">
                 {/* Pod View Toggle */}
                 {activeView === 'pods' && (
                     <div className="flex bg-black/40 p-1 rounded-lg border border-white/10 mr-2">
                         <button
                             onClick={() => setPodViewMode('list')}
                             className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all border ${
                                 podViewMode === 'list' 
                                 ? 'bg-blue-600/20 text-blue-400 border-blue-600/30 shadow-lg' 
                                 : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                             }`}
                         >
                             <Layers size={14} /> List
                         </button>
                         <button
                             onClick={() => setPodViewMode('visual')}
                             className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all border ${
                                 podViewMode === 'visual' 
                                 ? 'bg-blue-600/20 text-blue-400 border-blue-600/30 shadow-lg' 
                                 : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                             }`}
                         >
                             <Square size={14} /> Visual
                         </button>
                     </div>
                 )}

                 <NamespaceSelector 
                    namespaces={namespaces} 
                    selected={selectedNamespaces} 
                    onChange={setSelectedNamespaces} 
                 />
             {activeView === 'services' && (
                 <button
                    onClick={async () => {
                        if (confirm('Stop all active port forwards?')) {
                            await window.k8s.stopAllPortForwards();
                            // Optionally trigger a refresh or toast
                        }
                    }}
                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs border border-red-500/20 rounded flex items-center gap-2 transition-colors"
                 >
                    <Square size={14} fill="currentColor" />
                    Stop All Forwards
                 </button>
             )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
             {/* NODES TABLE */}
             {/* NODES TABLE */}
             {(activeView === 'nodes') && (
                <GenericResourceView 
                    viewKey="nodes"
                    description="The physical or virtual machines that make up the cluster."
                    headers={['Name', 'Status', 'Roles', 'Version', 'Age']}
                    data={nodes}
                    onRowClick={(node: any) => handleResourceClick(node, 'node')}
                    renderRow={(node: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{node.name}</td>
                            <td className="px-6 py-3">
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                    node.status === 'Ready' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                }`}>
                                    {node.status}
                                </span>
                            </td>
                            <td className="px-6 py-3 text-gray-400">{node.roles}</td>
                            <td className="px-6 py-3 text-gray-400">{node.version}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={node.age} /></td>
                        </>
                    )}
                />
             )}

             {/* CUSTOM RESOURCES TABLE */}
             {/* CUSTOM RESOURCES TABLE */}
             {(isCrdView) && (
                <GenericResourceView 
                    viewKey={`crd-${currentCrdKind}`}
                    description={currentCrdKind || 'Custom Resources'}
                    headers={['Name', 'Namespace', 'Age']}
                    data={customObjects}
                    renderRow={(obj: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{obj.name}</td>
                            <td className="px-6 py-3 text-gray-400">{obj.namespace || '-'}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={obj.age} /></td>
                        </>
                    )}
                    onRowClick={(obj: any) => handleResourceClick(obj, 'custom-resource')}
                />
             )}

             {/* CRD DEFINITIONS TABLE */}
             {/* CRD DEFINITIONS TABLE */}
            {activeView === 'crd-definitions' && (
                <GenericResourceView 
                    viewKey="crd-definitions"
                    description="Definitions of Custom Resources installed in the cluster."
                    headers={['Name', 'Group', 'Kind', 'Scope', 'Age']}
                    data={crdDefinitions}
                    onRowClick={(crd: any) => handleResourceClick(crd, 'crd-definition')}
                    renderRow={(crd: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{crd.name}</td>
                            <td className="px-6 py-3 text-blue-400">{crd.group}</td>
                            <td className="px-6 py-3 text-gray-300">{crd.kind}</td>
                            <td className="px-6 py-3 text-gray-400">{crd.scope}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={crd.age} /></td>
                        </>
                    )}
                />
            )}

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
                          onNavigate={onNavigate}
                          onSwitchToVisualPods={() => setPodViewMode('visual')}
                      />
                  </motion.div>
              )}

             {/* DEPLOYMENTS TABLE */}
             {/* DEPLOYMENTS TABLE */}
             {(activeView === 'deployments') && (
                <GenericResourceView 
                    viewKey="deployments"
                    description="Manage your application deployments and scaling strategies."
                    headers={['Name', 'Namespace', 'Replicas', 'Status']}
                    data={deployments}
                    onRowClick={(dep: any) => handleResourceClick(dep, 'deployment')}
                    renderRow={(dep: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{dep.name}</td>
                            <td className="px-6 py-3 text-gray-400">{dep.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{dep.availableReplicas || 0} / {dep.replicas || 0}</td>
                            <td className="px-6 py-3">
                                <StatusBadge condition={dep.availableReplicas === dep.replicas && dep.replicas > 0} />
                            </td>
                        </>
                    )}
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
                />
             )}
             
             {/* REPLICA SETS TABLE */}
             {/* REPLICA SETS TABLE */}
             {(activeView === 'replicasets') && (
                <GenericResourceView 
                    viewKey="replicasets"
                    description="Ensures a specified number of pod replicas are running at any given time."
                    headers={['Name', 'Namespace', 'Desired', 'Current', 'Ready']}
                    data={replicaSets}
                    onRowClick={(rs: any) => handleResourceClick(rs, 'replicaset')}
                    renderRow={(rs: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{rs.name}</td>
                            <td className="px-6 py-3 text-gray-400">{rs.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{rs.desired}</td>
                            <td className="px-6 py-3 text-gray-400">{rs.current}</td>
                            <td className="px-6 py-3 text-gray-400">{rs.ready}</td>
                        </>
                    )}
                />
             )}

             {/* SERVICES TABLE */}
             {/* SERVICES TABLE */}
             {(activeView === 'services') && (
                <GenericResourceView 
                    viewKey="services"
                    description="Network services for your application components."
                    headers={['Name', 'Namespace', 'Type', 'Cluster IP', 'Ports', 'Age']}
                    data={services}
                    onRowClick={(svc: any) => handleResourceClick(svc, 'service')}
                    renderRow={(svc: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{svc.name}</td>
                            <td className="px-6 py-3 text-gray-400">{svc.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{svc.type}</td>
                            <td className="px-6 py-3 text-gray-400 font-mono text-xs">{svc.clusterIP}</td>
                            <td className="px-6 py-3 text-gray-400 font-mono text-xs">{svc.ports}</td>
                            <td className="px-6 py-3 text-gray-400">{new Date(svc.age).toLocaleDateString()}</td>
                        </>
                    )}
                />
             )}

             {/* CLUSTER ROLE BINDINGS TABLE */}
             {/* CLUSTER ROLE BINDINGS TABLE */}
             {(activeView === 'clusterrolebindings') && (
                <GenericResourceView 
                    viewKey="clusterrolebindings"
                    description="Cluster-wide access control and permission bindings."
                    headers={['Name', 'Age']}
                    data={clusterRoleBindings}
                    onRowClick={(crb: any) => handleResourceClick(crb, 'clusterrolebinding')}
                    renderRow={(crb: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{crb.name}</td>
                            <td className="px-6 py-3 text-gray-400">{new Date(crb.age).toLocaleDateString()}</td>
                        </>
                    )}
                />
             )}

             {/* ROLE BINDINGS TABLE */}
             {/* ROLE BINDINGS TABLE */}
             {(activeView === 'rolebindings') && (
                <GenericResourceView 
                    viewKey="rolebindings"
                    description="Namespace-scoped permissions and access control."
                    headers={['Name', 'Namespace', 'Age']}
                    data={roleBindings}
                    onRowClick={(rb: any) => handleResourceClick(rb, 'rolebinding')}
                    renderRow={(rb: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{rb.name}</td>
                            <td className="px-6 py-3 text-gray-400">{rb.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{new Date(rb.age).toLocaleDateString()}</td>
                        </>
                    )}
                />
             )}


             {/* SERVICE ACCOUNTS TABLE */}
             {/* SERVICE ACCOUNTS TABLE */}
             {(activeView === 'serviceaccounts') && (
                <GenericResourceView 
                    viewKey="serviceaccounts"
                    description="Identities for processes that run in a Pod."
                    headers={['Name', 'Namespace', 'Secrets', 'Age']}
                    data={serviceAccounts}
                    onRowClick={(sa: any) => handleResourceClick(sa, 'serviceaccount')}
                    renderRow={(sa: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{sa.name}</td>
                            <td className="px-6 py-3 text-gray-400">{sa.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{sa.secrets}</td>
                            <td className="px-6 py-3 text-gray-400">{new Date(sa.age).toLocaleDateString()}</td>
                        </>
                    )}
                />
             )}

             {/* ROLES TABLE */}
             {/* ROLES TABLE */}
             {(activeView === 'roles') && (
                <GenericResourceView 
                    viewKey="roles"
                    description="Sets of permissions within a specific namespace."
                    headers={['Name', 'Namespace', 'Age']}
                    data={roles}
                    onRowClick={(r: any) => handleResourceClick(r, 'role')}
                    renderRow={(r: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{r.name}</td>
                            <td className="px-6 py-3 text-gray-400">{r.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{new Date(r.age).toLocaleDateString()}</td>
                        </>
                    )}
                />
             )}
             {/* DAEMONSETS TABLE */}
             {/* DAEMONSETS TABLE */}
             {(activeView === 'daemonsets') && (
                <GenericResourceView 
                    viewKey="daemonsets"
                    description="Ensures that all (or some) Nodes run a copy of a Pod."
                    headers={['Name', 'Namespace', 'Desired', 'Current', 'Ready', 'Available', 'Age']}
                    data={daemonSets}
                    onRowClick={(ds: any) => handleResourceClick(ds, 'daemonset')}
                    renderRow={(ds: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{ds.name}</td>
                            <td className="px-6 py-3 text-gray-400">{ds.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{ds.desired}</td>
                            <td className="px-6 py-3 text-gray-400">{ds.current}</td>
                            <td className="px-6 py-3 text-gray-400">{ds.ready}</td>
                            <td className="px-6 py-3 text-gray-400">{ds.available}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={ds.age} /></td>
                        </>
                    )}
                />
             )}

             {/* STATEFULSETS TABLE */}
             {/* STATEFULSETS TABLE */}
             {(activeView === 'statefulsets') && (
                <GenericResourceView 
                    viewKey="statefulsets"
                    description="Manages the deployment and scaling of a set of Pods, and provides guarantees about the ordering and uniqueness of these Pods."
                    headers={['Name', 'Namespace', 'Replicas', 'Ready', 'Current', 'Age']}
                    data={statefulSets}
                    onRowClick={(sts: any) => handleResourceClick(sts, 'statefulset')}
                    renderRow={(sts: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{sts.name}</td>
                            <td className="px-6 py-3 text-gray-400">{sts.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{sts.replicas}</td>
                            <td className="px-6 py-3 text-gray-400">{sts.ready}</td>
                            <td className="px-6 py-3 text-gray-400">{sts.current}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={sts.age} /></td>
                        </>
                    )}
                />
             )}

             {/* JOBS TABLE */}
             {/* JOBS TABLE */}
             {(activeView === 'jobs') && (
                <GenericResourceView 
                    viewKey="jobs"
                    description="A Job creates one or more Pods and will continue to retry execution of the Pods until a specified number of them successfully terminate."
                    headers={['Name', 'Namespace', 'Completions', 'Succeeded', 'Active', 'Failed', 'Age']}
                    data={jobs}
                    onRowClick={(job: any) => handleResourceClick(job, 'job')}
                    renderRow={(job: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{job.name}</td>
                            <td className="px-6 py-3 text-gray-400">{job.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{job.completions}</td>
                            <td className="px-6 py-3 text-gray-400 text-green-400">{job.succeeded}</td>
                            <td className="px-6 py-3 text-gray-400 text-blue-400">{job.active}</td>
                            <td className="px-6 py-3 text-gray-400 text-red-400">{job.failed}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={job.age} /></td>
                        </>
                    )}
                />
             )}

             {/* CRONJOBS TABLE */}
             {/* CRONJOBS TABLE */}
             {(activeView === 'cronjobs') && (
                <GenericResourceView 
                    viewKey="cronjobs"
                    description="Runs Jobs on a time-based schedule."
                    headers={['Name', 'Namespace', 'Schedule', 'Suspend', 'Active', 'Last Schedule', 'Age']}
                    data={cronJobs}
                    onRowClick={(cj: any) => handleResourceClick(cj, 'cronjob')}
                    renderRow={(cj: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{cj.name}</td>
                            <td className="px-6 py-3 text-gray-400">{cj.namespace}</td>
                            <td className="px-6 py-3 text-gray-400 font-mono text-xs">{cj.schedule}</td>
                            <td className="px-6 py-3 text-gray-400">{cj.suspend ? 'True' : 'False'}</td>
                            <td className="px-6 py-3 text-gray-400">{cj.active}</td>
                            <td className="px-6 py-3 text-gray-400">{cj.lastScheduleTime ? <TimeAgo timestamp={cj.lastScheduleTime} /> : '-'}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={cj.age} /></td>
                        </>
                    )}
                />
             )}

             {/* NETWORK: ENDPOINT SLICES */}
             {/* NETWORK: ENDPOINT SLICES */}
             {(activeView === 'endpointslices') && (
                <GenericResourceView 
                    viewKey="endpointslices"
                    description="Scalable and extensible way to group network endpoints together."
                    headers={['Name', 'Namespace', 'Address Type', 'Ports', 'Endpoints', 'Age']}
                    data={endpointSlices}
                    onRowClick={(es: any) => handleResourceClick(es, 'endpointslice')}
                    renderRow={(es: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{es.name}</td>
                            <td className="px-6 py-3 text-gray-400">{es.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{es.addressType}</td>
                            <td className="px-6 py-3 text-gray-400">{es.ports}</td>
                            <td className="px-6 py-3 text-gray-400">{es.endpoints}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={es.age} /></td>
                        </>
                    )}
                />
             )}

             {/* NETWORK: ENDPOINTS */}
             {/* NETWORK: ENDPOINTS */}
             {(activeView === 'endpoints') && (
                <GenericResourceView 
                    viewKey="endpoints"
                    description="A list of IP addresses and ports for a Service."
                    headers={['Name', 'Namespace', 'Subsets', 'Age']}
                    data={endpoints}
                    onRowClick={(ep: any) => handleResourceClick(ep, 'endpoint')}
                    renderRow={(ep: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{ep.name}</td>
                            <td className="px-6 py-3 text-gray-400">{ep.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{ep.subsets}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={ep.age} /></td>
                        </>
                    )}
                />
             )}

             {/* NETWORK: INGRESSES */}
             {/* NETWORK: INGRESSES */}
             {(activeView === 'ingresses') && (
                <GenericResourceView 
                    viewKey="ingresses"
                    description="Manages external access to the services in a cluster, typically HTTP."
                    headers={['Name', 'Namespace', 'Class', 'Hosts', 'Address', 'Age']}
                    data={ingresses}
                    onRowClick={(ing: any) => handleResourceClick(ing, 'ingress')}
                    renderRow={(ing: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{ing.name}</td>
                            <td className="px-6 py-3 text-gray-400">{ing.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{ing.class}</td>
                            <td className="px-6 py-3 text-gray-400 font-mono text-xs">{ing.hosts}</td>
                            <td className="px-6 py-3 text-gray-400">{ing.address}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={ing.age} /></td>
                        </>
                    )}
                />
             )}

             {/* NETWORK: INGRESS CLASSES */}
             {/* NETWORK: INGRESS CLASSES */}
             {(activeView === 'ingressclasses') && (
                <GenericResourceView 
                    viewKey="ingressclasses"
                    description="Defines a type of Ingress controller."
                    headers={['Name', 'Controller', 'API Group', 'Kind', 'Age']}
                    data={ingressClasses}
                    onRowClick={(ic: any) => handleResourceClick(ic, 'ingressclass')}
                    renderRow={(ic: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{ic.name}</td>
                            <td className="px-6 py-3 text-gray-400">{ic.controller}</td>
                            <td className="px-6 py-3 text-gray-400">{ic.apiGroup || '-'}</td>
                            <td className="px-6 py-3 text-gray-400">{ic.kind || '-'}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={ic.age} /></td>
                        </>
                    )}
                />
             )}

             {/* NETWORK: NETWORK POLICIES */}
             {/* NETWORK: NETWORK POLICIES */}
             {(activeView === 'networkpolicies') && (
                <GenericResourceView 
                    viewKey="networkpolicies"
                    description="Controls how groups of Pods are allowed to communicate with each other and other network endpoints."
                    headers={['Name', 'Namespace', 'Pod Selector', 'Policy Types', 'Age']}
                    data={networkPolicies}
                    onRowClick={(np: any) => handleResourceClick(np, 'networkpolicy')}
                    renderRow={(np: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{np.name}</td>
                            <td className="px-6 py-3 text-gray-400">{np.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{np.podSelector}</td>
                            <td className="px-6 py-3 text-gray-400">{np.policyTypes}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={np.age} /></td>
                        </>
                    )}
                />
             )}

             {/* STORAGE: PVC */}
             {/* STORAGE: PVC */}
             {(activeView === 'persistentvolumeclaims') && (
                <GenericResourceView 
                    viewKey="pvcs"
                    description="A request for storage by a user."
                    headers={['Name', 'Namespace', 'Status', 'Volume', 'Capacity', 'Access Modes', 'Storage Class', 'Age']}
                    data={pvcs}
                    onRowClick={(pvc: any) => handleResourceClick(pvc, 'persistentvolumeclaim')}
                    renderRow={(pvc: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{pvc.name}</td>
                            <td className="px-6 py-3 text-gray-400">{pvc.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{pvc.status}</td>
                            <td className="px-6 py-3 text-gray-400">{pvc.volume}</td>
                            <td className="px-6 py-3 text-gray-400">{pvc.capacity}</td>
                            <td className="px-6 py-3 text-gray-400">{pvc.accessModes}</td>
                            <td className="px-6 py-3 text-gray-400">{pvc.storageClass}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={pvc.age} /></td>
                        </>
                    )}
                />
             )}

             {/* STORAGE: PV */}
             {(activeView === 'persistentvolumes') && (
                <GenericResourceView 
                    viewKey="persistentvolumes"
                    description="A piece of storage in the cluster that has been provisioned by an administrator or dynamically provisioned using Storage Classes."
                    headers={['Name', 'Capacity', 'Access Modes', 'Reclaim', 'Status', 'Claim', 'Storage Class', 'Age']}
                    data={pvs}
                    onRowClick={(pv: any) => handleResourceClick(pv, 'persistentvolume')}
                    renderRow={(pv: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{pv.name}</td>
                            <td className="px-6 py-3 text-gray-400">{pv.capacity}</td>
                            <td className="px-6 py-3 text-gray-400">{pv.accessModes}</td>
                            <td className="px-6 py-3 text-gray-400">{pv.reclaimPolicy}</td>
                            <td className="px-6 py-3 text-gray-400">{pv.status}</td>
                            <td className="px-6 py-3 text-gray-400">{pv.claim}</td>
                            <td className="px-6 py-3 text-gray-400">{pv.storageClass}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={pv.age} /></td>
                        </>
                    )}
                />
             )}

             {/* STORAGE: STORAGE CLASSES */}
             {(activeView === 'storageclasses') && (
                <GenericResourceView 
                    viewKey="storageclasses"
                    description="Describes the classes of storage offered by the cluster."
                    headers={['Name', 'Provisioner', 'Reclaim Policy', 'Volume Binding Mode', 'Age']}
                    data={storageClasses}
                    onRowClick={(sc: any) => handleResourceClick(sc, 'storageclass')}
                    renderRow={(sc: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{sc.name}</td>
                            <td className="px-6 py-3 text-gray-400">{sc.provisioner}</td>
                            <td className="px-6 py-3 text-gray-400">{sc.reclaimPolicy}</td>
                            <td className="px-6 py-3 text-gray-400">{sc.volumeBindingMode}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={sc.age} /></td>
                        </>
                    )}
                />
             )}

             {/* CONFIG RESOURCES */}
             {(activeView === 'configmaps') && (
                <GenericResourceView 
                    viewKey="configmaps"
                    description="ConfigMaps allow you to decouple configuration artifacts from image content."
                    headers={['Name', 'Namespace', 'Data Keys', 'Age']}
                    data={configMaps}
                    onRowClick={(cm: any) => handleResourceClick(cm, 'configmap')}
                    renderRow={(cm: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{cm.name}</td>
                            <td className="px-6 py-3 text-gray-400">{cm.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{cm.data}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={cm.age} /></td>
                        </>
                    )}
                />
             )}

             {(activeView === 'secrets') && (
                <GenericResourceView 
                    viewKey="secrets"
                    description="Secrets let you store and manage sensitive information."
                    headers={['Name', 'Namespace', 'Type', 'Data Keys', 'Age']}
                    data={secrets}
                    onRowClick={(secret: any) => handleResourceClick(secret, 'secret')}
                    renderRow={(secret: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{secret.name}</td>
                            <td className="px-6 py-3 text-gray-400">{secret.namespace}</td>
                            <td className="px-6 py-3 text-gray-400 text-xs">{secret.type}</td>
                            <td className="px-6 py-3 text-gray-400">{secret.data}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={secret.age} /></td>
                        </>
                    )}
                />
             )}

             {(activeView === 'horizontalpodautoscalers') && (
                <GenericResourceView 
                    viewKey="horizontalpodautoscalers"
                    description="Automatically scales the number of pods based on observed metrics."
                    headers={['Name', 'Namespace', 'Reference', 'Min Pods', 'Max Pods', 'Replicas', 'Age']}
                    data={horizontalPodAutoscalers}
                    onRowClick={(hpa: any) => handleResourceClick(hpa, 'horizontalpodautoscaler')}
                    renderRow={(hpa: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{hpa.name}</td>
                            <td className="px-6 py-3 text-gray-400">{hpa.namespace}</td>
                            <td className="px-6 py-3 text-blue-400 text-sm">{hpa.reference}</td>
                            <td className="px-6 py-3 text-gray-400">{hpa.minPods}</td>
                            <td className="px-6 py-3 text-gray-400">{hpa.maxPods}</td>
                            <td className="px-6 py-3 text-gray-400">{hpa.replicas}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={hpa.age} /></td>
                        </>
                    )}
                />
             )}

             {(activeView === 'poddisruptionbudgets') && (
                <GenericResourceView 
                    viewKey="poddisruptionbudgets"
                    description="Limits the number of pods that can be down simultaneously from voluntary disruptions."
                    headers={['Name', 'Namespace', 'Min Available', 'Max Unavailable', 'Allowed Disruptions', 'Age']}
                    data={podDisruptionBudgets}
                    onRowClick={(pdb: any) => handleResourceClick(pdb, 'poddisruptionbudget')}
                    renderRow={(pdb: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{pdb.name}</td>
                            <td className="px-6 py-3 text-gray-400">{pdb.namespace}</td>
                            <td className="px-6 py-3 text-gray-400">{pdb.minAvailable || '-'}</td>
                            <td className="px-6 py-3 text-gray-400">{pdb.maxUnavailable || '-'}</td>
                            <td className="px-6 py-3 text-gray-400">{pdb.allowed}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={pdb.age} /></td>
                        </>
                    )}
                />
             )}

             {(activeView === 'mutatingwebhookconfigurations') && (
                <GenericResourceView 
                    viewKey="mutatingwebhookconfigurations"
                    description="Defines admission webhooks that can mutate objects before they are stored."
                    headers={['Name', 'Webhooks', 'Age']}
                    data={mutatingWebhookConfigurations}
                    onRowClick={(mwc: any) => handleResourceClick(mwc, 'mutatingwebhookconfiguration')}
                    renderRow={(mwc: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{mwc.name}</td>
                            <td className="px-6 py-3 text-gray-400">{mwc.webhooks}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={mwc.age} /></td>
                        </>
                    )}
                />
             )}

             {(activeView === 'validatingwebhookconfigurations') && (
                <GenericResourceView 
                    viewKey="validatingwebhookconfigurations"
                    description="Defines admission webhooks that can validate objects before they are stored."
                    headers={['Name', 'Webhooks', 'Age']}
                    data={validatingWebhookConfigurations}
                    onRowClick={(vwc: any) => handleResourceClick(vwc, 'validatingwebhookconfiguration')}
                    renderRow={(vwc: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{vwc.name}</td>
                            <td className="px-6 py-3 text-gray-400">{vwc.webhooks}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={vwc.age} /></td>
                        </>
                    )}
                />
             )}

             {(activeView === 'priorityclasses') && (
                <GenericResourceView 
                    viewKey="priorityclasses"
                    description="Defines the priority of pods relative to other pods."
                    headers={['Name', 'Value', 'Global Default', 'Description', 'Age']}
                    data={priorityClasses}
                    onRowClick={(pc: any) => handleResourceClick(pc, 'priorityclass')}
                    renderRow={(pc: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{pc.name}</td>
                            <td className="px-6 py-3 text-gray-400">{pc.value}</td>
                            <td className="px-6 py-3 text-gray-400">{pc.globalDefault ? 'Yes' : 'No'}</td>
                            <td className="px-6 py-3 text-gray-400 text-sm max-w-xs truncate">{pc.description || '-'}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={pc.age} /></td>
                        </>
                    )}
                />
             )}

             {(activeView === 'runtimeclasses') && (
                <GenericResourceView 
                    viewKey="runtimeclasses"
                    description="Defines different classes of runtimes that may be used to run containers."
                    headers={['Name', 'Handler', 'Age']}
                    data={runtimeClasses}
                    onRowClick={(rc: any) => handleResourceClick(rc, 'runtimeclass')}
                    renderRow={(rc: any) => (
                        <>
                            <td className="px-6 py-3 font-medium text-gray-200">{rc.name}</td>
                            <td className="px-6 py-3 text-gray-400">{rc.handler}</td>
                            <td className="px-6 py-3 text-gray-400"><TimeAgo timestamp={rc.age} /></td>
                        </>
                    )}
                />
             )}
         </AnimatePresence>



      </div>
      {/* ... (Previous code) ... */}
      <Drawer 
         isOpen={isDrawerOpen} 
         onClose={() => {
            if (!isScaleModalOpen) {
                setIsDrawerOpen(false);
            }
         }} 
         title={selectedResource?.name || 'Details'}
         headerActions={
            <div className="flex items-center gap-2">
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
                
                {selectedResource?.type === 'deployment' && (
                     <button
                        onClick={() => setIsScaleModalOpen(true)}
                        className="p-1 px-3 ml-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/30 rounded-md text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors"
                        title="Scale Deployment"
                     >
                        <Activity size={14} /> Scale
                     </button>
                )}

                {selectedResource?.type === 'pod' && (
                    <button
                        onClick={handleDeletePod}
                        className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded transition-colors"
                        title="Delete Pod"
                    >
                        <Trash size={16} />
                    </button>
                )}
            </div>
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
                      explanation={explanation}
                      isExplaining={isExplaining}
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
      </Drawer>

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

    </div>
  );
}

// ResourceTable and StatusBadge moved to shared components
