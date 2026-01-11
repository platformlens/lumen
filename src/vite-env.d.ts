/// <reference types="vite/client" />

export { };

declare global {
    interface Window {
        k8s: {
            getClusters: () => Promise<any[]>;
            getNamespaces: (contextName: string) => Promise<string[]>;
            getNamespacesDetails: (contextName: string) => Promise<any[]>;
            getDeployments: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getPods: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getPod: (contextName: string, namespace: string, name: string) => Promise<any>;
            getReplicaSets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getServices: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getClusterRoleBindings: (contextName: string) => Promise<any[]>;
            getRoleBindings: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getDeployment: (contextName: string, namespace: string, name: string) => Promise<any>;
            restartDeployment: (contextName: string, namespace: string, name: string) => Promise<{ success: boolean }>;
            getService: (contextName: string, namespace: string, name: string) => Promise<any>;
            getEvents: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getNodes: (contextName: string) => Promise<any[]>;
            getNode: (contextName: string, name: string) => Promise<any>;
            getCRDs: (contextName: string) => Promise<any[]>;
            getCRD: (contextName: string, name: string) => Promise<any>;
            listCustomObjects: (contextName: string, group: string, version: string, plural: string, namespace?: string) => Promise<any[]>;
            getCustomObjects: (contextName: string, group: string, version: string, plural: string) => Promise<any[]>;
            getClusterRoleBinding: (contextName: string, name: string) => Promise<any>;
            getDaemonSets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getDaemonSet: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteDaemonSet: (contextName: string, namespace: string, name: string) => Promise<boolean>;
            getStatefulSets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getStatefulSet: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteStatefulSet: (contextName: string, namespace: string, name: string) => Promise<boolean>;
            getJobs: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getJob: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteJob: (contextName: string, namespace: string, name: string) => Promise<boolean>;
            getCronJobs: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getCronJob: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteCronJob: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            // --- Network ---
            getEndpointSlices: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getEndpointSlice: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteEndpointSlice: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            getEndpoints: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getEndpoint: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteEndpoint: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            getIngresses: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getIngress: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteIngress: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            getIngressClasses: (contextName: string) => Promise<any[]>;
            getIngressClass: (contextName: string, name: string) => Promise<any>;
            deleteIngressClass: (contextName: string, name: string) => Promise<boolean>;

            getNetworkPolicies: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getNetworkPolicy: (contextName: string, namespace: string, name: string) => Promise<any>;
            deleteNetworkPolicy: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            // --- Storage ---
            getPersistentVolumeClaims: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getPersistentVolumeClaim: (contextName: string, namespace: string, name: string) => Promise<any>;
            deletePersistentVolumeClaim: (contextName: string, namespace: string, name: string) => Promise<boolean>;

            getPersistentVolumes: (contextName: string) => Promise<any[]>;
            getPersistentVolume: (contextName: string, name: string) => Promise<any>;
            deletePersistentVolume: (contextName: string, name: string) => Promise<boolean>;

            getStorageClasses: (contextName: string) => Promise<any[]>;
            getStorageClass: (contextName: string, name: string) => Promise<any>;
            deleteStorageClass: (contextName: string, name: string) => Promise<boolean>;

            // --- Config ---
            getConfigMaps: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getConfigMap: (contextName: string, namespace: string, name: string) => Promise<any>;

            getSecrets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getSecret: (contextName: string, namespace: string, name: string) => Promise<any>;

            getHorizontalPodAutoscalers: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getHorizontalPodAutoscaler: (contextName: string, namespace: string, name: string) => Promise<any>;

            getPodDisruptionBudgets: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getPodDisruptionBudget: (contextName: string, namespace: string, name: string) => Promise<any>;
            getPdbYaml: (contextName: string, namespace: string, name: string) => Promise<string>;
            updatePdbYaml: (contextName: string, namespace: string, name: string, yamlContent: string) => Promise<any>;

            // Generic resource YAML operations
            getResourceYaml: (contextName: string, apiVersion: string, kind: string, name: string, namespace?: string) => Promise<string>;
            updateResourceYaml: (contextName: string, apiVersion: string, kind: string, name: string, yamlContent: string, namespace?: string) => Promise<any>;

            getMutatingWebhookConfigurations: (contextName: string) => Promise<any[]>;
            getMutatingWebhookConfiguration: (contextName: string, name: string) => Promise<any>;

            getValidatingWebhookConfigurations: (contextName: string) => Promise<any[]>;
            getValidatingWebhookConfiguration: (contextName: string, name: string) => Promise<any>;

            getPriorityClasses: (contextName: string) => Promise<any[]>;
            getPriorityClass: (contextName: string, name: string) => Promise<any>;

            getRuntimeClasses: (contextName: string) => Promise<any[]>;
            getRuntimeClass: (contextName: string, name: string) => Promise<any>;

            // --- Access Control ---
            getServiceAccounts: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getServiceAccount: (contextName: string, namespace: string, name: string) => Promise<any>;
            getRoles: (contextName: string, namespaces?: string[]) => Promise<any[]>;
            getRole: (contextName: string, namespace: string, name: string) => Promise<any>;
            getReplicaSet: (contextName: string, namespace: string, name: string) => Promise<any>;
            scaleDeployment: (contextName: string, namespace: string, name: string, replicas: number) => Promise<void>;
            getDeploymentYaml: (contextName: string, namespace: string, name: string) => Promise<string>;
            updateDeploymentYaml: (contextName: string, namespace: string, name: string, yamlContent: string) => Promise<any>;
            startPortForward: (contextName: string, namespace: string, serviceName: string, servicePort: number, localPort: number, resourceType?: 'service' | 'pod') => Promise<{ id: string, localPort: number }>;
            stopAllPortForwards: () => Promise<void>;
            stopPortForward: (id: string) => Promise<void>;
            getActivePortForwards: () => Promise<any[]>;
            explainResource: (resource: any, model?: string) => Promise<string>;
            openExternal: (url: string) => Promise<void>;
            deletePod: (contextName: string, namespace: string, name: string) => Promise<boolean>;
            watchPods: (contextName: string, namespaces?: string[]) => void;
            stopWatchPods: () => void;
            onPodChange: (callback: (type: string, pod: any) => void) => () => void;
            watchDeployments: (contextName: string, namespaces?: string[]) => void;
            stopWatchDeployments: () => void;
            onDeploymentChange: (callback: (type: string, deployment: any) => void) => () => void;
            watchNodes: (contextName: string) => void;
            stopWatchNodes: () => void;
            onNodeChange: (callback: (type: string, node: any) => void) => () => void;
            streamPodLogs: (contextName: string, namespace: string, name: string, containerName: string) => void;
            stopStreamPodLogs: (namespace: string, name: string, containerName: string) => Promise<void>;
            onPodLogChunk: (callback: (streamId: string, chunk: string) => void) => () => void;

            // --- Settings ---
            saveApiKey: (key: string) => Promise<boolean>;
            getApiKey: () => Promise<string>;

            // --- Terminal ---
            terminal: {
                create: (id: string, cols: number, rows: number) => void;
                write: (id: string, data: string) => void;
                resize: (id: string, cols: number, rows: number) => void;
                dispose: (id: string) => void;
                onData: (callback: (id: string, data: string) => void) => () => void;
                onExit: (callback: (id: string, exitCode: number) => void) => () => void;
            };

            aws: {
                getEksCluster: (region: string, clusterName: string) => Promise<any>;
                getVpcDetails: (region: string, vpcId: string) => Promise<any>;
                getSubnets: (region: string, vpcId: string) => Promise<any[]>;
                getInstanceDetails: (region: string, instanceId: string) => Promise<any>;
                getEc2Instances: (region: string, vpcId: string, clusterName?: string) => Promise<any[]>;
                getDbInstances?: (region: string, vpcId: string) => Promise<any[]>; // Not yet implemented in preload, but preparing
                getPodIdentities: (region: string, clusterName: string) => Promise<any[]>;
                checkAuth: (region: string) => Promise<{ isAuthenticated: boolean; identity?: string; account?: string; error?: string }>;
                clearCache: () => Promise<boolean>;
            };

            app: {
                restart: () => Promise<void>;
            };
        }
    }
}
