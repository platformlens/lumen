import { KubeConfig, AppsV1Api, CoreV1Api, RbacAuthorizationV1Api, ApiextensionsV1Api, CustomObjectsApi, BatchV1Api, NetworkingV1Api, StorageV1Api, DiscoveryV1Api, PortForward, Watch, Log, AutoscalingV2Api, PolicyV1Api, AdmissionregistrationV1Api, SchedulingV1Api, NodeV1Api } from '@kubernetes/client-node';
import * as net from 'net';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';

interface ActiveForward {
    id: string;
    namespace: string;
    // serviceName represents the resource name (service or pod)
    serviceName: string;
    resourceType: 'service' | 'pod';
    inputPort: string | number; // The port identifier passed by UI (e.g. 80 or "http")
    targetPort: number; // The resolved numeric port on the pod
    localPort: number;
    server: net.Server;
    sockets: Set<net.Socket>;
}

interface CertificateInfo {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    serialNumber: string;
    fingerprint: string;
    sans: string[];
}

export class K8sService {
    private kc: KubeConfig;
    private activeForwards: Map<string, ActiveForward> = new Map();
    private activeWatchers: Map<string, any> = new Map();
    private activeLogStreams: Map<string, any> = new Map();

    constructor() {
        this.kc = new KubeConfig();
        try {
            this.kc.loadFromDefault();
            console.log('KubeConfig loaded from default.');
        } catch (err) {
            console.error('Error loading KubeConfig:', err);
        }
    }

    getActivePortForwards() {
        return Array.from(this.activeForwards.values()).map(f => ({
            id: f.id,
            namespace: f.namespace,
            serviceName: f.serviceName,
            resourceType: f.resourceType || 'service', // default for back-compat if any persisted, though we don't persist active forwards
            inputPort: f.inputPort,
            targetPort: f.targetPort,
            localPort: f.localPort
        }));
    }

    async startPortForward(contextName: string, namespace: string, resourceName: string, port: number, localPort: number, resourceType: 'service' | 'pod' = 'service') {
        console.log(`[k8s] startPortForward for ${resourceType} ${namespace}/${resourceName}:${port} -> ${localPort}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);
        const forward = new PortForward(this.kc);

        let podName = '';
        let targetPortNum: number;
        // Check if port is physically a string or number, even if typed as number (IPC args)
        const inputPort = port as unknown as (string | number);

        if (resourceType === 'pod') {
            // Direct pod forwarding
            podName = resourceName;

            // For pods, we must verify the pod exists and resolve the port if it's named
            const podRes = await k8sApi.readNamespacedPod({ name: podName, namespace });
            const targetPod = (podRes as any).body ? (podRes as any).body : podRes;

            if (!targetPod) {
                throw new Error(`Pod ${podName} not found`);
            }

            if (typeof inputPort === 'number') {
                targetPortNum = inputPort;
            } else {
                const parsed = parseInt(inputPort, 10);
                if (!isNaN(parsed) && parsed.toString() === inputPort.toString()) {
                    targetPortNum = parsed;
                } else {
                    // Resolve named port on Pod
                    console.log(`[k8s] Resolving named port '${inputPort}' for pod ${podName}`);
                    let foundPort = -1;
                    if (targetPod.spec && targetPod.spec.containers) {
                        for (const container of targetPod.spec.containers) {
                            if (container.ports) {
                                const match = container.ports.find((p: any) => p.name === inputPort);
                                if (match) {
                                    foundPort = match.containerPort;
                                    break;
                                }
                            }
                        }
                    }
                    if (foundPort === -1) {
                        throw new Error(`Could not resolve named port '${inputPort}' to a numeric port in pod ${podName}`);
                    }
                    targetPortNum = foundPort;
                }
            }

        } else {
            // Service forwarding (old logic)
            // 1. Find a pod for the service
            const serviceName = resourceName;

            let service;
            try {
                const res = await k8sApi.readNamespacedService({ name: serviceName, namespace });
                service = (res as any).body ? (res as any).body : res;
            } catch (e) {
                // fallback
                const res = await (k8sApi as any).readNamespacedService(serviceName, namespace);
                service = (res as any).body ? (res as any).body : res;
            }

            if (!service || !service.spec || !service.spec.selector) {
                throw new Error(`Service ${serviceName} has no selector or does not exist.`);
            }

            // List pods matching selector
            const labelSelector = Object.entries(service.spec.selector).map(([k, v]) => `${k}=${v}`).join(',');
            const podsRes = await k8sApi.listNamespacedPod({ namespace, labelSelector });
            const pods = (podsRes as any).body ? (podsRes as any).body.items : podsRes.items;

            const targetPod = pods.find((p: any) => p.status.phase === 'Running');
            if (!targetPod) {
                throw new Error(`No running pods found for service ${serviceName}`);
            }

            podName = targetPod.metadata.name;

            // Resolve Target Port if it is a name
            if (typeof inputPort === 'number') {
                targetPortNum = inputPort;
            } else {
                // It's a string, try to parse it as int just in case "80" was passed
                const parsed = parseInt(inputPort, 10);
                if (!isNaN(parsed) && parsed.toString() === inputPort.toString()) {
                    targetPortNum = parsed;
                } else {
                    // It's a named port, we must resolve it from the pod spec
                    console.log(`[k8s] Resolving named port '${inputPort}' for pod ${podName}`);
                    let foundPort = -1;

                    // Iterate over containers to find the port by name
                    if (targetPod.spec && targetPod.spec.containers) {
                        for (const container of targetPod.spec.containers) {
                            if (container.ports) {
                                const match = container.ports.find((p: any) => p.name === inputPort);
                                if (match) {
                                    foundPort = match.containerPort;
                                    break;
                                }
                            }
                        }
                    }

                    if (foundPort === -1) {
                        throw new Error(`Could not resolve named port '${inputPort}' to a numeric port in pod ${podName}`);
                    }
                    targetPortNum = foundPort;
                    console.log(`[k8s] Resolved '${inputPort}' to ${targetPortNum}`);
                }
            }
        }

        // 2. Start Local Server
        const sockets = new Set<net.Socket>();
        const server = net.createServer((socket) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));

            forward.portForward(namespace, podName, [targetPortNum], socket, null, socket)
                .catch(err => {
                    console.error('[k8s] Port forward socket error:', err);
                    socket.end();
                });
        });

        // 3. Listen
        return new Promise<{ id: string, localPort: number }>((resolve, reject) => {
            server.listen(localPort, '127.0.0.1', () => {
                const address = server.address() as net.AddressInfo;
                const actualLocalPort = address.port;
                const id = `${namespace}-${resourceName}-${actualLocalPort}`;

                this.activeForwards.set(id, {
                    id,
                    namespace,
                    serviceName: resourceName,
                    resourceType,
                    inputPort,
                    targetPort: targetPortNum,
                    localPort: actualLocalPort,
                    server,
                    sockets
                });

                console.log(`[k8s] Port forwarding started: localhost:${actualLocalPort} -> ${podName}:${targetPortNum}`);
                resolve({ id, localPort: actualLocalPort });
            });

            server.on('error', (err) => {
                console.error('[k8s] Port forward server error:', err);
                reject(err);
            });
        });
    }

    async stopPortForward(id: string) {
        console.log(`[k8s] Stopping port forward ${id}`);
        const forward = this.activeForwards.get(id);
        if (forward) {
            this.activeForwards.delete(id);

            // Immediately destroy all active connections
            if (forward.sockets) {
                for (const socket of forward.sockets) {
                    socket.destroy();
                }
                forward.sockets.clear();
            }

            return new Promise<boolean>((resolve) => {
                forward.server.close(() => {
                    console.log(`[k8s] Port forward ${id} stopped and port released.`);
                    resolve(true);
                });
            });
        }
        return false;
    }

    async stopAllPortForwards() {
        console.log(`[k8s] Stopping ALL port forwards`);
        for (const [, forward] of this.activeForwards) {
            // Immediately destroy all active connections
            if (forward.sockets) {
                for (const socket of forward.sockets) {
                    socket.destroy();
                }
                forward.sockets.clear();
            }
            forward.server.close();
        }
        this.activeForwards.clear();
        return true;
    }

    getClusters() {
        const contexts = this.kc.getContexts();
        console.log(`Found ${contexts.length} contexts.`);
        return contexts.map(ctx => ({
            name: ctx.name,
            cluster: ctx.cluster,
            user: ctx.user,
        }));
    }

    async getNamespaces(contextName: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);
        // Error propagation is required for connection verification
        const res = await k8sApi.listNamespace();
        const items = (res as any).body ? (res as any).body.items : (res as any).items;
        return items.map((ns: any) => ns.metadata?.name).filter(Boolean) as string[];
    }

    async getNamespacesDetails(contextName: string) {
        console.log(`[k8s] getNamespacesDetails for ${contextName}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sApi.listNamespace();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            return items.map((ns: any) => ({
                name: ns.metadata?.name,
                status: ns.status?.phase,
                labels: ns.metadata?.labels,
                annotations: ns.metadata?.annotations,
                age: ns.metadata?.creationTimestamp,
                metadata: ns.metadata,
                spec: ns.spec,
                statusObj: ns.status
            }));
        } catch (error) {
            console.error('Error fetching namespace details:', error);
            return [];
        }
    }

    async getDeployments(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AppsV1Api);

        let items: any[] = [];

        if (namespaces.length === 0 || namespaces.includes('all')) {
            const res = await k8sApi.listDeploymentForAllNamespaces();
            items = (res as any).body ? (res as any).body.items : (res as any).items;
        } else {
            const promises = namespaces.map(ns => k8sApi.listNamespacedDeployment({ namespace: ns }));
            const results = await Promise.all(promises);
            items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
        }

        return items.map((dep: any) => ({
            name: dep.metadata?.name,
            namespace: dep.metadata?.namespace,
            replicas: dep.spec?.replicas,
            availableReplicas: dep.status?.availableReplicas,
            status: dep.status,
            metadata: dep.metadata,
            spec: dep.spec
        }));
    }

    async getDeployment(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AppsV1Api);
        try {
            const res = await k8sApi.readNamespacedDeployment({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error fetching deployment:", error);
            return null;
        }
    }

    async getDeploymentYaml(contextName: string, namespace: string, name: string) {
        console.log(`[k8s] getDeploymentYaml for ${namespace}/${name}`);
        const dep = await this.getDeployment(contextName, namespace, name);
        if (!dep) return null;

        // Clean up metadata that shouldn't be edited usually
        // But for full edit, we send it all.
        // Actually, users might want to edit spec.

        try {
            return yaml.dump(dep);
        } catch (e) {
            console.error('Error dumping yaml:', e);
            throw e;
        }
    }

    async updateDeploymentYaml(contextName: string, namespace: string, name: string, yamlContent: string) {
        console.log(`[k8s] updateDeploymentYaml for ${namespace}/${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AppsV1Api);

        let newObj: any;
        try {
            newObj = yaml.load(yamlContent);
        } catch (e) {
            throw new Error(`Invalid YAML: ${e}`);
        }

        try {
            // Use replace (PUT)
            const res = await k8sApi.replaceNamespacedDeployment({
                name,
                namespace,
                body: newObj
            });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error updating deployment:", error);
            throw error;
        }
    }

    async scaleDeployment(contextName: string, namespace: string, name: string, replicas: number) {
        console.log(`[k8s] scaleDeployment called for ${namespace}/${name} to ${replicas}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AppsV1Api);
        try {
            const patch = [
                {
                    op: 'replace',
                    path: '/spec/replicas',
                    value: replicas
                }
            ];
            const options = { "headers": { "Content-type": "application/json-patch+json" } };
            const res = await k8sApi.patchNamespacedDeployment({
                name,
                namespace,
                body: patch
            }, options as any);
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error scaling deployment:", error);
            throw error;
        }
    }

    async getPods(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);

        let items: any[] = [];

        if (namespaces.length === 0 || namespaces.includes('all')) {
            const res = await k8sApi.listPodForAllNamespaces();
            items = (res as any).body ? (res as any).body.items : (res as any).items;
        } else {
            const promises = namespaces.map(ns => k8sApi.listNamespacedPod({ namespace: ns }));
            const results = await Promise.all(promises);
            items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
        }

        return items.map((pod: any) => {
            const containerStatuses = pod.status?.containerStatuses || [];
            const initContainerStatuses = pod.status?.initContainerStatuses || [];

            const allStatuses = [...initContainerStatuses, ...containerStatuses];

            return {
                name: pod.metadata?.name,
                namespace: pod.metadata?.namespace,
                status: pod.status?.phase,
                restarts: containerStatuses.reduce((acc: number, c: any) => acc + c.restartCount, 0) || 0,
                age: pod.metadata?.creationTimestamp,
                containers: allStatuses.map((c: any) => ({
                    name: c.name,
                    state: c.state?.running ? 'running' : (c.state?.waiting ? 'waiting' : 'terminated'),
                    ready: c.ready,
                    image: c.image,
                    restartCount: c.restartCount
                })),
                metadata: pod.metadata,
                spec: pod.spec,
                node: pod.spec?.nodeName
            };
        });
    }

    async getPod(contextName: string, namespace: string, name: string) {
        console.log(`[k8s] getPod called for ${namespace}/${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sApi.readNamespacedPod({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error fetching pod:", error);
            // Fallback for positional args if needed
            try {
                const res = await (k8sApi as any).readNamespacedPod(name, namespace);
                return (res as any).body ? (res as any).body : res;
            } catch (fbError) {
                console.error("Error fetching pod (fallback):", fbError);
                return null;
            }
        }
    }

    async deletePod(contextName: string, namespace: string, name: string) {
        console.log(`[k8s] deletePod called for ${namespace}/${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);
        try {
            await k8sApi.deleteNamespacedPod({ name, namespace });
            return true;
        } catch (error) {
            console.error("Error deleting pod:", error);
            try {
                // Fallback
                await (k8sApi as any).deleteNamespacedPod(name, namespace);
                return true;
            } catch (fbError) {
                console.error("Error deleting pod (fallback):", fbError);
                throw fbError;
            }
        }
    }

    async startPodWatch(contextName: string, namespaces: string[] = [], onEvent: (event: string, pod: any) => void) {
        // Stop existing watcher if any to avoid duplicates
        this.stopPodWatch();

        const activeWatchersKey = (ns: string[]) => ns.length === 0 || ns.includes('all') ? 'all-namespaces' : ns.join(',');
        console.log(`[k8s] Starting watch for pods in ${activeWatchersKey(namespaces)}`);
        this.kc.setCurrentContext(contextName);
        const watch = new Watch(this.kc);

        const path = (namespaces.length === 0 || namespaces.includes('all'))
            ? '/api/v1/pods'
            : `/api/v1/namespaces/${namespaces[0]}/pods`;

        try {
            const req = await watch.watch(
                path,
                {},
                (type, apiObj, _watchObj) => {
                    if (type === 'ADDED' || type === 'MODIFIED' || type === 'DELETED') {
                        if (!apiObj || !apiObj.metadata) return;

                        const containerStatuses = apiObj.status?.containerStatuses || [];
                        const initContainerStatuses = apiObj.status?.initContainerStatuses || [];
                        const allStatuses = [...initContainerStatuses, ...containerStatuses];

                        const pod = {
                            name: apiObj.metadata?.name,
                            namespace: apiObj.metadata?.namespace,
                            status: apiObj.status?.phase,
                            restarts: containerStatuses.reduce((acc: number, c: any) => acc + c.restartCount, 0) || 0,
                            age: apiObj.metadata?.creationTimestamp,
                            containers: allStatuses.map((c: any) => ({
                                name: c.name,
                                state: c.state?.running ? 'running' : (c.state?.waiting ? 'waiting' : 'terminated'),
                                ready: c.ready,
                                image: c.image,
                                restartCount: c.restartCount
                            })),
                            metadata: apiObj.metadata,
                            spec: apiObj.spec,
                            node: apiObj.spec?.nodeName
                        };
                        onEvent(type, pod);
                    }
                },
                (err) => {
                    if (err) console.error('Watch exited with error', err);
                }
            );

            // Store the request object which has the abort method
            this.activeWatchers.set('pods', req);
        } catch (err) {
            console.error('[k8s] Failed to start pod watch:', err);
        }
    }

    stopPodWatch() {
        if (this.activeWatchers.has('pods')) {
            console.log('[k8s] Stopping pod watch');
            const req = this.activeWatchers.get('pods');
            if (req && req.abort) req.abort(); // Check if req has abort
            this.activeWatchers.delete('pods');
        }

    }

    async startDeploymentWatch(contextName: string, namespaces: string[] = [], onEvent: (event: string, deployment: any) => void) {
        this.stopDeploymentWatch();

        const activeWatchersKey = (ns: string[]) => ns.length === 0 || ns.includes('all') ? 'all-namespaces' : ns.join(',');
        console.log(`[k8s] Starting watch for deployments in ${activeWatchersKey(namespaces)}`);
        this.kc.setCurrentContext(contextName);
        const watch = new Watch(this.kc);

        const path = (namespaces.length === 0 || namespaces.includes('all'))
            ? '/apis/apps/v1/deployments'
            : `/apis/apps/v1/namespaces/${namespaces[0]}/deployments`;

        try {
            const req = await watch.watch(
                path,
                {},
                (type, apiObj, _watchObj) => {
                    if (type === 'ADDED' || type === 'MODIFIED' || type === 'DELETED') {
                        if (!apiObj || !apiObj.metadata) return;

                        const dep = {
                            name: apiObj.metadata?.name,
                            namespace: apiObj.metadata?.namespace,
                            replicas: apiObj.spec?.replicas,
                            availableReplicas: apiObj.status?.availableReplicas,
                            status: apiObj.status,
                            metadata: apiObj.metadata,
                            spec: apiObj.spec
                        };
                        onEvent(type, dep);
                    }
                },
                (err) => {
                    // Ignore abort errors as they are expected when stopping the watch
                    if (err && (err.name === 'AbortError' || (err as any).type === 'aborted')) {
                        console.log('[k8s] Deployment watch aborted (expected)');
                        return;
                    }
                    if (err) console.error('Deployment Watch exited with error', err);
                }
            );

            this.activeWatchers.set('deployments', req);
        } catch (err) {
            console.error('[k8s] Failed to start deployment watch:', err);
        }
    }

    stopDeploymentWatch() {
        if (this.activeWatchers.has('deployments')) {
            console.log('[k8s] Stopping deployment watch');
            const req = this.activeWatchers.get('deployments');
            if (req && req.abort) req.abort();
            this.activeWatchers.delete('deployments');
        }
    }


    async getReplicaSets(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AppsV1Api);

        let items: any[] = [];

        if (namespaces.length === 0 || namespaces.includes('all')) {
            const res = await k8sApi.listReplicaSetForAllNamespaces();
            items = (res as any).body ? (res as any).body.items : (res as any).items;
        } else {
            const promises = namespaces.map(ns => k8sApi.listNamespacedReplicaSet({ namespace: ns }));
            const results = await Promise.all(promises);
            items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
        }

        return items.map((rs: any) => ({
            name: rs.metadata?.name,
            namespace: rs.metadata?.namespace,
            desired: rs.spec?.replicas,
            current: rs.status?.replicas,
            ready: rs.status?.readyReplicas,
            metadata: rs.metadata,
            spec: rs.spec
        }));
    }

    async restartDeployment(contextName: string, namespace: string, deploymentName: string) {
        console.log(`[restartDeployment] Called with context=${contextName}, ns=${namespace}, name=${deploymentName}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AppsV1Api);

        try {
            // 1. Fetch existing deployment
            const res = await k8sApi.readNamespacedDeployment({ name: deploymentName, namespace });
            const deployment = (res as any).body ? (res as any).body : res;

            // 2. Update restartedAt annotation
            if (!deployment.spec) deployment.spec = {};
            if (!deployment.spec.template) deployment.spec.template = {};
            if (!deployment.spec.template.metadata) deployment.spec.template.metadata = {};
            if (!deployment.spec.template.metadata.annotations) deployment.spec.template.metadata.annotations = {};

            deployment.spec.template.metadata.annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString();

            // 3. Patch the deployment
            await k8sApi.replaceNamespacedDeployment({
                name: deploymentName,
                namespace,
                body: deployment
            });

            return { success: true };
        } catch (error) {
            console.error('Error restarting deployment:', error);
            throw error;
        }
    }

    async restartDaemonSet(contextName: string, namespace: string, name: string) {
        console.log(`[restartDaemonSet] Called with context=${contextName}, ns=${namespace}, name=${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AppsV1Api);

        try {
            const res = await k8sApi.readNamespacedDaemonSet({ name, namespace });
            const daemonSet = (res as any).body ? (res as any).body : res;

            if (!daemonSet.spec) daemonSet.spec = {};
            if (!daemonSet.spec.template) daemonSet.spec.template = {};
            if (!daemonSet.spec.template.metadata) daemonSet.spec.template.metadata = {};
            if (!daemonSet.spec.template.metadata.annotations) daemonSet.spec.template.metadata.annotations = {};

            daemonSet.spec.template.metadata.annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString();

            await k8sApi.replaceNamespacedDaemonSet({ name, namespace, body: daemonSet });
            return { success: true };
        } catch (error) {
            console.error('Error restarting daemonset:', error);
            throw error;
        }
    }

    async restartStatefulSet(contextName: string, namespace: string, name: string) {
        console.log(`[restartStatefulSet] Called with context=${contextName}, ns=${namespace}, name=${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AppsV1Api);

        try {
            const res = await k8sApi.readNamespacedStatefulSet({ name, namespace });
            const statefulSet = (res as any).body ? (res as any).body : res;

            if (!statefulSet.spec) statefulSet.spec = {};
            if (!statefulSet.spec.template) statefulSet.spec.template = {};
            if (!statefulSet.spec.template.metadata) statefulSet.spec.template.metadata = {};
            if (!statefulSet.spec.template.metadata.annotations) statefulSet.spec.template.metadata.annotations = {};

            statefulSet.spec.template.metadata.annotations['kubectl.kubernetes.io/restartedAt'] = new Date().toISOString();

            await k8sApi.replaceNamespacedStatefulSet({ name, namespace, body: statefulSet });
            return { success: true };
        } catch (error) {
            console.error('Error restarting statefulset:', error);
            throw error;
        }
    }


    async getReplicaSet(contextName: string, namespace: string, name: string) {
        console.log(`[k8s] getReplicaSet called with: context = ${contextName}, namespace = ${namespace}, name = ${name} `);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AppsV1Api);
        try {
            console.log('[k8s] calling readNamespacedReplicaSet API...');
            const res = await k8sApi.readNamespacedReplicaSet({ name, namespace });
            console.log('[k8s] readNamespacedReplicaSet success');
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error fetching replicaset:", error);
            // Log full error details
            if (error && typeof error === 'object') {
                console.error('Error details:', JSON.stringify(error, null, 2));
            }
            return null;
        }
    }

    async getServices(contextName: string, namespaces: string[] = []) {
        console.log(`Getting services for ${contextName}, namespaces: ${namespaces} `);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);

        let items: any[] = [];
        try {
            if (namespaces.includes('all')) {
                const res = await k8sApi.listServiceForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sApi.listNamespacedService({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(r => (r as any).body ? (r as any).body.items : (r as any).items);
            }
        } catch (error) {
            console.error('Error fetching services:', error);
            return [];
        }

        console.log(`Found ${items.length} services`);
        return items.map((svc: any) => ({
            name: svc.metadata?.name,
            namespace: svc.metadata?.namespace,
            type: svc.spec?.type,
            clusterIP: svc.spec?.clusterIP,
            ports: svc.spec?.ports?.map((p: any) => `${p.port}:${p.targetPort}/${p.protocol}`).join(', '),
            age: svc.metadata?.creationTimestamp,
            metadata: svc.metadata,
            spec: svc.spec
        }));
    }

    async getClusterRoles(contextName: string) {
        console.log(`[k8s] getClusterRoles called`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(RbacAuthorizationV1Api);
        try {
            const res = await k8sApi.listClusterRole();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            return items.map((cr: any) => ({
                name: cr.metadata?.name,
                age: cr.metadata?.creationTimestamp,
                metadata: cr.metadata,
                rules: cr.rules
            }));
        } catch (error) {
            console.error("Error fetching ClusterRoles:", error);
            return [];
        }
    }

    async getClusterRole(contextName: string, name: string) {
        console.log(`[k8s] getClusterRole called for ${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(RbacAuthorizationV1Api);
        try {
            const res = await k8sApi.readClusterRole({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error fetching ClusterRole:", error);
            return null;
        }
    }

    async getClusterRoleBinding(contextName: string, name: string) {
        console.log(`[k8s] getClusterRoleBinding called for ${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(RbacAuthorizationV1Api);
        try {
            const res = await k8sApi.readClusterRoleBinding({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error fetching ClusterRoleBinding:", error);
            return null;
        }
    }

    async getService(contextName: string, namespace: string, name: string) {
        console.log(`[k8s] getService called for ${namespace}/${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);
        try {
            // Try object style first
            const res = await k8sApi.readNamespacedService({ name, namespace });
            console.log('[k8s] readNamespacedService success');
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.warn('[k8s] Error fetching service (object style), trying positional fallback:', error);
            try {
                // Fallback to positional arguments for safety
                const res = await (k8sApi as any).readNamespacedService(name, namespace);
                return (res as any).body ? (res as any).body : res;
            } catch (fallbackError) {
                console.error("Error fetching service (final):", fallbackError);
                return null;
            }
        }
    }

    async getServiceAccounts(contextName: string, namespaces: string[] = []) {
        console.log(`Getting ServiceAccounts for ${contextName}, namespaces: ${namespaces}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);

        let items: any[] = [];
        try {
            if (namespaces.includes('all')) {
                const res = await k8sApi.listServiceAccountForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sApi.listNamespacedServiceAccount({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(r => (r as any).body ? (r as any).body.items : (r as any).items);
            }
        } catch (error) {
            console.error('Error fetching ServiceAccounts:', error);
            return [];
        }

        console.log(`Found ${items.length} ServiceAccounts`);
        return items.map((sa: any) => ({
            name: sa.metadata?.name,
            namespace: sa.metadata?.namespace,
            age: sa.metadata?.creationTimestamp,
            secrets: sa.secrets?.length || 0
        }));
    }

    async getServiceAccount(contextName: string, namespace: string, name: string) {
        console.log(`[k8s] getServiceAccount called for ${namespace}/${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sApi.readNamespacedServiceAccount({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error fetching ServiceAccount:", error);
            return null;
        }
    }

    async getClusterRoleBindings(contextName: string) {
        console.log(`Getting ClusterRoleBindings for ${contextName}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(RbacAuthorizationV1Api);
        try {
            const res = await k8sApi.listClusterRoleBinding();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log(`Found ${items.length} ClusterRoleBindings`);
            return items.map((crb: any) => ({
                name: crb.metadata?.name,
                age: crb.metadata?.creationTimestamp
            }));
        } catch (error) {
            console.error('Error fetching ClusterRoleBindings:', error);
            return [];
        }
    }

    async getRoles(contextName: string, namespaces: string[] = []) {
        console.log(`Getting Roles for ${contextName}, namespaces: ${namespaces}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(RbacAuthorizationV1Api);

        let items: any[] = [];
        try {
            if (namespaces.includes('all')) {
                const res = await k8sApi.listRoleForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sApi.listNamespacedRole({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(r => (r as any).body ? (r as any).body.items : (r as any).items);
            }
        } catch (error) {
            console.error('Error fetching Roles:', error);
            return [];
        }

        console.log(`Found ${items.length} Roles`);
        return items.map((r: any) => ({
            name: r.metadata?.name,
            namespace: r.metadata?.namespace,
            age: r.metadata?.creationTimestamp
        }));
    }

    async getRole(contextName: string, namespace: string, name: string) {
        console.log(`[k8s] getRole called for ${namespace}/${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(RbacAuthorizationV1Api);
        try {
            const res = await k8sApi.readNamespacedRole({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error fetching Role:", error);
            return null;
        }
    }

    async getRoleBindings(contextName: string, namespaces: string[] = []) {
        console.log(`Getting RoleBindings for ${contextName}, namespaces: ${namespaces}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(RbacAuthorizationV1Api);

        let items: any[] = [];
        try {
            if (namespaces.includes('all')) {
                const res = await k8sApi.listRoleBindingForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sApi.listNamespacedRoleBinding({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(r => (r as any).body ? (r as any).body.items : (r as any).items);
            }
        } catch (error) {
            console.error('Error fetching RoleBindings:', error);
            return [];
        }

        console.log(`Found ${items.length} RoleBindings`);
        return items.map((rb: any) => ({
            name: rb.metadata?.name,
            namespace: rb.metadata?.namespace,
            age: rb.metadata?.creationTimestamp
        }));
    }

    async getRoleBinding(contextName: string, namespace: string, name: string) {
        console.log(`[k8s] getRoleBinding called for ${namespace}/${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(RbacAuthorizationV1Api);
        try {
            const res = await k8sApi.readNamespacedRoleBinding({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error fetching RoleBinding:", error);
            return null;
        }
    }

    async getCRD(contextName: string, name: string) {
        // console.log(`[k8s] getCRD called for ${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(ApiextensionsV1Api);
        try {
            const res = await k8sApi.readCustomResourceDefinition({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            // Common to fail if not exists
            return null;
        }
    }

    async listCustomObjects(contextName: string, group: string, version: string, plural: string, namespace: string = '') {
        console.log(`[k8s] listCustomObjects for ${group}/${version}/${plural} in ns=${namespace}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CustomObjectsApi);

        try {
            let res;
            if (namespace) {
                res = await k8sApi.listNamespacedCustomObject({
                    group,
                    version,
                    namespace,
                    plural
                });
            } else {
                res = await k8sApi.listClusterCustomObject({
                    group,
                    version,
                    plural
                });
            }
            const body = (res as any).body ? (res as any).body : res;
            return body.items || [];
        } catch (error) {
            console.error(`Error listing custom objects ${group}/${version}/${plural}:`, error);
            return [];
        }
    }


    async streamPodLogs(contextName: string, namespace: string, name: string, containerName: string, onData: (data: string) => void) {
        console.log(`[k8s] streamPodLogs called for ${namespace}/${name}`);
        this.kc.setCurrentContext(contextName);
        const log = new Log(this.kc);

        const streamId = `${namespace}-${name}-${containerName}`;

        console.log(`[k8s] streamPodLogs params: context=${contextName}, ns=${namespace}, pod=${name}, container=${containerName}`);

        // Stop existing stream if any
        await this.stopStreamPodLogs(streamId);

        // Ensure context is set (redundant but safe)
        this.kc.setCurrentContext(contextName);

        // The log.log method writes to the stream passed.
        // But the client-node Log class implementation for 'follow' returns a promise that resolves when the request is made?
        // Wait, log.log signature with follow updates is a bit tricky. 
        // Actually, we should pass a Writable stream to capture output.

        // Let's implement a Writable stream wrapper effectively.
        // Or simpler, we can use the 'log' instance to get a request.

        // Correct usage of @kubernetes/client-node Log for streaming is slightly varying by version.
        // Assuming version 0.18+ or 1.0.
        // The library writes to the provided stream.

        const { PassThrough } = await import('stream');
        const stream = new PassThrough();

        stream.on('data', (chunk) => {
            onData(chunk.toString());
        });

        try {
            const req = await log.log(namespace, name, containerName, stream, {
                follow: true,
                tailLines: 100,
                pretty: false,
                timestamps: false,
            });

            // Store request for aborting
            this.activeLogStreams.set(streamId, req);

            // Handle close
            // Check if req has .on (it should if it's an IncomingMessage or Request)
            if (req && typeof (req as any).on === 'function') {
                (req as any).on('close', () => {
                    console.log(`[k8s] Log stream closed (req): ${streamId}`);
                    this.activeLogStreams.delete(streamId);
                });
            } else {
                console.warn(`[k8s] returned req object does not have .on() method`);
                // Fallback: listen to stream?
                stream.on('close', () => {
                    console.log(`[k8s] Log stream closed (stream): ${streamId}`);
                    this.activeLogStreams.delete(streamId);
                });
            }

            console.log(`[k8s] Log stream started for ${streamId}`);

        } catch (e) {
            console.error(`[k8s] Error streaming logs:`, e);
            stream.end();
            throw e;
        }
    }

    async stopStreamPodLogs(streamId: string) {
        if (this.activeLogStreams.has(streamId)) {
            console.log(`[k8s] Stopping log stream ${streamId}`);
            const req = this.activeLogStreams.get(streamId);
            if (req && typeof (req as any).destroy === 'function') {
                (req as any).destroy(); // Abort the request
            } else if (req && typeof (req as any).abort === 'function') {
                (req as any).abort();
            }
            this.activeLogStreams.delete(streamId);
        }
    }
    async getEvents(contextName: string, namespaces: string[] = [], fieldSelector?: string) {
        console.log(`Getting Events for ${contextName}, namespaces: ${namespaces}, fieldSelector: ${fieldSelector}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);

        let items: any[] = [];
        try {
            if (namespaces.includes('all')) {
                const res = await k8sApi.listEventForAllNamespaces({ fieldSelector });
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sApi.listNamespacedEvent({ namespace: ns, fieldSelector }));
                const results = await Promise.all(promises);
                items = results.flatMap(r => (r as any).body ? (r as any).body.items : (r as any).items);
            }
        } catch (error) {
            console.error('Error fetching Events:', error);
            return [];
        }

        // Sort by lastTimestamp descending
        items.sort((a: any, b: any) => {
            const timeA = new Date(a.lastTimestamp || a.eventTime || a.metadata.creationTimestamp).getTime();
            const timeB = new Date(b.lastTimestamp || b.eventTime || b.metadata.creationTimestamp).getTime();
            return timeB - timeA;
        });

        console.log(`Found ${items.length} Events`);
        return items.map((e: any) => ({
            type: e.type,
            reason: e.reason,
            message: e.message,
            count: e.count,
            lastTimestamp: e.lastTimestamp || e.eventTime || e.metadata.creationTimestamp,
            object: `${e.involvedObject.kind}/${e.involvedObject.name}`,
            namespace: e.metadata.namespace
        }));
    }
    async getNodes(contextName: string) {
        console.log(`Getting Nodes for ${contextName}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sApi.listNode();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log(`Found ${items.length} Nodes`);
            return items.map((node: any) => ({
                name: node.metadata.name,
                status: node.status.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True' ? 'Ready' : 'NotReady',
                roles: Object.keys(node.metadata.labels || {})
                    .filter(k => k.startsWith('node-role.kubernetes.io/'))
                    .map(k => k.split('/')[1])
                    .join(', ') || 'worker',
                version: node.status.nodeInfo.kubeletVersion,
                age: node.metadata.creationTimestamp,
                cpu: node.status.capacity?.cpu,
                memory: node.status.capacity?.memory,
                metadata: node.metadata
            }));
        } catch (error) {
            console.error('Error fetching Nodes:', error);
            return [];
        }
    }

    async getNode(contextName: string, name: string) {
        console.log(`[k8s] getNode called for ${name}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sApi.readNode({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error fetching Node:", error);
            // Fallback
            try {
                const res = await (k8sApi as any).readNode(name);
                return (res as any).body ? (res as any).body : res;
            } catch (fbError) {
                console.error("Error fetching Node (fallback):", fbError);
                return null;
            }
        }
    }



    async getCRDs(contextName: string) {
        console.log(`Getting CRDs for ${contextName}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(ApiextensionsV1Api);
        try {
            const res = await k8sApi.listCustomResourceDefinition();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log(`Found ${items.length} CRDs`);
            return items.map((crd: any) => ({
                name: crd.metadata.name,
                kind: crd.spec.names.kind,
                plural: crd.spec.names.plural,
                group: crd.spec.group,
                versions: crd.spec.versions.map((v: any) => v.name),
                scope: crd.spec.scope,
                age: crd.metadata.creationTimestamp
            }));
        } catch (error) {
            console.error('Error fetching CRDs:', error);
            return [];
        }
    }

    async getCustomObjects(contextName: string, group: string, version: string, plural: string) {
        console.log(`Getting Custom Objects for ${contextName}: ${group}/${version}/${plural}`);
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(CustomObjectsApi);
        try {
            const res = await k8sApi.listClusterCustomObject({ group, version, plural });
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log(`Found ${items.length} Custom Objects`);
            return items.map((obj: any) => ({
                name: obj.metadata.name,
                namespace: obj.metadata.namespace,
                age: obj.metadata.creationTimestamp,
                ...obj
            }));
        } catch (error) {
            console.error(`Error fetching Custom Objects (${group}/${version}/${plural}):`, error);
            return [];
        }
    }

    public async getDaemonSets(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sAppsApi = this.kc.makeApiClient(AppsV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sAppsApi.listDaemonSetForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sAppsApi.listNamespacedDaemonSet({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            return items.map((ds: any) => ({
                name: ds.metadata?.name,
                namespace: ds.metadata?.namespace,
                desired: ds.status?.desiredNumberScheduled,
                current: ds.status?.currentNumberScheduled,
                ready: ds.status?.numberReady,
                available: ds.status?.numberAvailable,
                age: ds.metadata?.creationTimestamp,
                metadata: ds.metadata,
                spec: ds.spec,
                status: ds.status
            }));
        } catch (err: any) {
            console.error('Error fetching DaemonSets:', err);
            return [];
        }
    }

    public async getDaemonSet(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sAppsApi = this.kc.makeApiClient(AppsV1Api);
        try {
            const res = await k8sAppsApi.readNamespacedDaemonSet({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching DaemonSet ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async deleteDaemonSet(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sAppsApi = this.kc.makeApiClient(AppsV1Api);
        try {
            await k8sAppsApi.deleteNamespacedDaemonSet({ name, namespace });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting DaemonSet ${namespace}/${name}:`, err);
            throw err;
        }
    }

    public async getStatefulSets(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sAppsApi = this.kc.makeApiClient(AppsV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sAppsApi.listStatefulSetForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sAppsApi.listNamespacedStatefulSet({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            return items.map((sts: any) => ({
                name: sts.metadata?.name,
                namespace: sts.metadata?.namespace,
                replicas: sts.spec?.replicas,
                ready: sts.status?.readyReplicas || 0,
                current: sts.status?.currentReplicas || 0,
                age: sts.metadata?.creationTimestamp,
                items: sts.metadata,
                spec: sts.spec,
                status: sts.status
            }));
        } catch (err: any) {
            console.error('Error fetching StatefulSets:', err);
            return [];
        }
    }

    public async getStatefulSet(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sAppsApi = this.kc.makeApiClient(AppsV1Api);
        try {
            const res = await k8sAppsApi.readNamespacedStatefulSet({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching StatefulSet ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async deleteStatefulSet(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sAppsApi = this.kc.makeApiClient(AppsV1Api);
        try {
            await k8sAppsApi.deleteNamespacedStatefulSet({ name, namespace });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting StatefulSet ${namespace}/${name}:`, err);
            throw err;
        }
    }

    public async getJobs(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sBatchApi = this.kc.makeApiClient(BatchV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sBatchApi.listJobForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sBatchApi.listNamespacedJob({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            return items.map((job: any) => ({
                name: job.metadata?.name,
                namespace: job.metadata?.namespace,
                completions: job.spec?.completions,
                parallelism: job.spec?.parallelism,
                succeeded: job.status?.succeeded || 0,
                active: job.status?.active || 0,
                failed: job.status?.failed || 0,
                startTime: job.status?.startTime,
                completionTime: job.status?.completionTime,
                age: job.metadata?.creationTimestamp,
                metadata: job.metadata,
                spec: job.spec,
                status: job.status
            }));
        } catch (err: any) {
            console.error('Error fetching Jobs:', err);
            return [];
        }
    }

    public async getJob(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sBatchApi = this.kc.makeApiClient(BatchV1Api);
        try {
            const res = await k8sBatchApi.readNamespacedJob({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching Job ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async deleteJob(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sBatchApi = this.kc.makeApiClient(BatchV1Api);
        try {
            await k8sBatchApi.deleteNamespacedJob({ name, namespace, propagationPolicy: 'Foreground' });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting Job ${namespace}/${name}:`, err);
            throw err;
        }
    }

    public async getCronJobs(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sBatchApi = this.kc.makeApiClient(BatchV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sBatchApi.listCronJobForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sBatchApi.listNamespacedCronJob({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            return items.map((cj: any) => ({
                name: cj.metadata?.name,
                namespace: cj.metadata?.namespace,
                schedule: cj.spec?.schedule,
                suspend: cj.spec?.suspend,
                active: cj.status?.active?.length || 0,
                lastScheduleTime: cj.status?.lastScheduleTime,
                age: cj.metadata?.creationTimestamp,
                metadata: cj.metadata,
                spec: cj.spec,
                status: cj.status
            }));
        } catch (err: any) {
            console.error('Error fetching CronJobs:', err);
            return [];
        }
    }

    public async getCronJob(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sBatchApi = this.kc.makeApiClient(BatchV1Api);
        try {
            const res = await k8sBatchApi.readNamespacedCronJob({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching CronJob ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async deleteCronJob(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sBatchApi = this.kc.makeApiClient(BatchV1Api);
        try {
            await k8sBatchApi.deleteNamespacedCronJob({ name, namespace });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting CronJob ${namespace}/${name}:`, err);
            throw err;
        }
    }
    // --- Network Resources ---

    public async getEndpointSlices(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sDiscoveryApi = this.kc.makeApiClient(DiscoveryV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sDiscoveryApi.listEndpointSliceForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sDiscoveryApi.listNamespacedEndpointSlice({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            console.log('EndpointSlices found:', items.length);
            return items.map((es: any) => ({
                name: es.metadata?.name,
                namespace: es.metadata?.namespace,
                addressType: es.addressType,
                ports: es.ports?.map((p: any) => `${p.name || ''}:${p.port}/${p.protocol}`).join(', '),
                endpoints: es.endpoints?.length || 0,
                age: es.metadata?.creationTimestamp,
                metadata: es.metadata,
                scope: es.endpoints,
                portsRaw: es.ports
            }));
        } catch (err: any) {
            console.error('Error fetching EndpointSlices:', err);
            return [];
        }
    }

    public async getEndpointSlice(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sDiscoveryApi = this.kc.makeApiClient(DiscoveryV1Api);
        try {
            const res = await k8sDiscoveryApi.readNamespacedEndpointSlice({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching EndpointSlice ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async deleteEndpointSlice(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sDiscoveryApi = this.kc.makeApiClient(DiscoveryV1Api);
        try {
            await k8sDiscoveryApi.deleteNamespacedEndpointSlice({ name, namespace });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting EndpointSlice ${namespace}/${name}:`, err);
            throw err;
        }
    }

    public async getEndpoints(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sCoreApi.listEndpointsForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sCoreApi.listNamespacedEndpoints({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            console.log('Endpoints found:', items.length);
            return items.map((ep: any) => ({
                name: ep.metadata?.name,
                namespace: ep.metadata?.namespace,
                subsets: ep.subsets?.length || 0,
                age: ep.metadata?.creationTimestamp,
                metadata: ep.metadata,
                subsetsRaw: ep.subsets
            }));
        } catch (err: any) {
            console.error('Error fetching Endpoints:', err);
            return [];
        }
    }

    public async getEndpoint(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sCoreApi.readNamespacedEndpoints({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching Endpoint ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async deleteEndpoint(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);
        try {
            await k8sCoreApi.deleteNamespacedEndpoints({ name, namespace });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting Endpoint ${namespace}/${name}:`, err);
            throw err;
        }
    }

    public async getIngresses(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sNetworkingApi = this.kc.makeApiClient(NetworkingV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sNetworkingApi.listIngressForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sNetworkingApi.listNamespacedIngress({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            console.log('Ingresses found:', items.length);
            return items.map((ing: any) => ({
                name: ing.metadata?.name,
                namespace: ing.metadata?.namespace,
                class: ing.spec?.ingressClassName,
                hosts: ing.spec?.rules?.map((r: any) => r.host).join(', '),
                address: ing.status?.loadBalancer?.ingress?.map((i: any) => i.ip || i.hostname).join(', '),
                age: ing.metadata?.creationTimestamp,
                metadata: ing.metadata,
                spec: ing.spec,
                status: ing.status
            }));
        } catch (err: any) {
            console.error('Error fetching Ingresses:', err);
            return [];
        }
    }

    public async getIngress(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sNetworkingApi = this.kc.makeApiClient(NetworkingV1Api);
        try {
            const res = await k8sNetworkingApi.readNamespacedIngress({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching Ingress ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async deleteIngress(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sNetworkingApi = this.kc.makeApiClient(NetworkingV1Api);
        try {
            await k8sNetworkingApi.deleteNamespacedIngress({ name, namespace });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting Ingress ${namespace}/${name}:`, err);
            throw err;
        }
    }

    public async getIngressClasses(contextName: string) {
        this.kc.setCurrentContext(contextName);
        const k8sNetworkingApi = this.kc.makeApiClient(NetworkingV1Api);

        try {
            const res = await k8sNetworkingApi.listIngressClass();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log('IngressClasses found:', items.length);
            return items.map((ic: any) => ({
                name: ic.metadata?.name,
                controller: ic.spec?.controller,
                apiGroup: ic.spec?.parameters?.apiGroup,
                kind: ic.spec?.parameters?.kind,
                age: ic.metadata?.creationTimestamp,
                metadata: ic.metadata,
                spec: ic.spec
            }));
        } catch (err: any) {
            console.error('Error fetching IngressClasses:', err);
            return [];
        }
    }

    public async getIngressClass(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sNetworkingApi = this.kc.makeApiClient(NetworkingV1Api);
        try {
            const res = await k8sNetworkingApi.readIngressClass({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching IngressClass ${name}:`, err);
            return null;
        }
    }

    public async deleteIngressClass(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sNetworkingApi = this.kc.makeApiClient(NetworkingV1Api);
        try {
            await k8sNetworkingApi.deleteIngressClass({ name });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting IngressClass ${name}:`, err);
            throw err;
        }
    }

    public async getNetworkPolicies(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sNetworkingApi = this.kc.makeApiClient(NetworkingV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sNetworkingApi.listNetworkPolicyForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sNetworkingApi.listNamespacedNetworkPolicy({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            console.log('NetworkPolicies found:', items.length);
            return items.map((np: any) => ({
                name: np.metadata?.name,
                namespace: np.metadata?.namespace,
                podSelector: np.spec?.podSelector?.matchLabels ? JSON.stringify(np.spec.podSelector.matchLabels) : '',
                policyTypes: np.spec?.policyTypes?.join(', '),
                age: np.metadata?.creationTimestamp,
                metadata: np.metadata,
                spec: np.spec
            }));
        } catch (err: any) {
            console.error('Error fetching NetworkPolicies:', err);
            return [];
        }
    }

    public async getNetworkPolicy(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sNetworkingApi = this.kc.makeApiClient(NetworkingV1Api);
        try {
            const res = await k8sNetworkingApi.readNamespacedNetworkPolicy({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching NetworkPolicy ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async deleteNetworkPolicy(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sNetworkingApi = this.kc.makeApiClient(NetworkingV1Api);
        try {
            await k8sNetworkingApi.deleteNamespacedNetworkPolicy({ name, namespace });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting NetworkPolicy ${namespace}/${name}:`, err);
            throw err;
        }
    }

    // --- Storage Resources ---

    public async getPersistentVolumeClaims(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sCoreApi.listPersistentVolumeClaimForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sCoreApi.listNamespacedPersistentVolumeClaim({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            console.log('PVCs found:', items.length);
            return items.map((pvc: any) => ({
                name: pvc.metadata?.name,
                namespace: pvc.metadata?.namespace,
                status: pvc.status?.phase,
                volume: pvc.spec?.volumeName,
                capacity: pvc.status?.capacity?.storage,
                accessModes: pvc.spec?.accessModes?.join(', '),
                storageClass: pvc.spec?.storageClassName,
                age: pvc.metadata?.creationTimestamp,
                metadata: pvc.metadata,
                spec: pvc.spec,
                statusRaw: pvc.status
            }));
        } catch (err: any) {
            console.error('Error fetching PersistentVolumeClaims:', err);
            return [];
        }
    }

    public async getPersistentVolumeClaim(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sCoreApi.readNamespacedPersistentVolumeClaim({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching PersistentVolumeClaim ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async deletePersistentVolumeClaim(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);
        try {
            await k8sCoreApi.deleteNamespacedPersistentVolumeClaim({ name, namespace });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting PersistentVolumeClaim ${namespace}/${name}:`, err);
            throw err;
        }
    }

    public async getPersistentVolumes(contextName: string) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);

        try {
            const res = await k8sCoreApi.listPersistentVolume();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log('PVs found:', items.length);
            return items.map((pv: any) => ({
                name: pv.metadata?.name,
                capacity: pv.spec?.capacity?.storage,
                accessModes: pv.spec?.accessModes?.join(', '),
                reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy,
                status: pv.status?.phase,
                claim: pv.spec?.claimRef ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}` : '',
                storageClass: pv.spec?.storageClassName,
                age: pv.metadata?.creationTimestamp,
                metadata: pv.metadata,
                spec: pv.spec,
                statusRaw: pv.status
            }));
        } catch (err: any) {
            console.error('Error fetching PersistentVolumes:', err);
            return [];
        }
    }

    public async getPersistentVolume(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sCoreApi.readPersistentVolume({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching PersistentVolume ${name}:`, err);
            return null;
        }
    }

    public async deletePersistentVolume(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);
        try {
            await k8sCoreApi.deletePersistentVolume({ name });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting PersistentVolume ${name}:`, err);
            throw err;
        }
    }

    public async getStorageClasses(contextName: string) {
        this.kc.setCurrentContext(contextName);
        const k8sStorageApi = this.kc.makeApiClient(StorageV1Api);

        try {
            const res = await k8sStorageApi.listStorageClass();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log('StorageClasses found:', items.length);
            return items.map((sc: any) => ({
                name: sc.metadata?.name,
                provisioner: sc.provisioner,
                reclaimPolicy: sc.reclaimPolicy,
                volumeBindingMode: sc.volumeBindingMode,
                age: sc.metadata?.creationTimestamp,
                metadata: sc.metadata,
                parameters: sc.parameters
            }));
        } catch (err: any) {
            console.error('Error fetching StorageClasses:', err);
            return [];
        }
    }

    public async getStorageClass(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sStorageApi = this.kc.makeApiClient(StorageV1Api);
        try {
            const res = await k8sStorageApi.readStorageClass({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching StorageClass ${name}:`, err);
            return null;
        }
    }

    public async deleteStorageClass(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sStorageApi = this.kc.makeApiClient(StorageV1Api);
        try {
            await k8sStorageApi.deleteStorageClass({ name });
            return { success: true };
        } catch (err) {
            console.error(`Error deleting StorageClass ${name}:`, err);
            throw err;
        }
    }

    // --- Config Resources ---

    public async getConfigMaps(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sCoreApi.listConfigMapForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sCoreApi.listNamespacedConfigMap({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            console.log('ConfigMaps found:', items.length);
            return items.map((cm: any) => ({
                name: cm.metadata?.name,
                namespace: cm.metadata?.namespace,
                data: Object.keys(cm.data || {}).length,
                age: cm.metadata?.creationTimestamp,
                metadata: cm.metadata,
                dataRaw: cm.data
            }));
        } catch (err: any) {
            console.error('Error fetching ConfigMaps:', err);
            return [];
        }
    }

    public async getConfigMap(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sCoreApi.readNamespacedConfigMap({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching ConfigMap ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async getSecrets(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sCoreApi.listSecretForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sCoreApi.listNamespacedSecret({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            console.log('Secrets found:', items.length);
            return items.map((secret: any) => ({
                name: secret.metadata?.name,
                namespace: secret.metadata?.namespace,
                type: secret.type,
                data: Object.keys(secret.data || {}).length,
                age: secret.metadata?.creationTimestamp,
                metadata: secret.metadata
            }));
        } catch (err: any) {
            console.error('Error fetching Secrets:', err);
            return [];
        }
    }

    public async getSecret(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sCoreApi = this.kc.makeApiClient(CoreV1Api);
        try {
            const res = await k8sCoreApi.readNamespacedSecret({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching Secret ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async getHorizontalPodAutoscalers(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AutoscalingV2Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sApi.listHorizontalPodAutoscalerForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sApi.listNamespacedHorizontalPodAutoscaler({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            console.log('HPAs found:', items.length);
            return items.map((hpa: any) => ({
                name: hpa.metadata?.name,
                namespace: hpa.metadata?.namespace,
                reference: `${hpa.spec?.scaleTargetRef?.kind}/${hpa.spec?.scaleTargetRef?.name}`,
                minPods: hpa.spec?.minReplicas,
                maxPods: hpa.spec?.maxReplicas,
                replicas: hpa.status?.currentReplicas,
                age: hpa.metadata?.creationTimestamp,
                metadata: hpa.metadata,
                spec: hpa.spec,
                status: hpa.status
            }));
        } catch (err: any) {
            console.error('Error fetching HPAs:', err);
            return [];
        }
    }

    public async getHorizontalPodAutoscaler(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AutoscalingV2Api);
        try {
            const res = await k8sApi.readNamespacedHorizontalPodAutoscaler({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching HPA ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async getPodDisruptionBudgets(contextName: string, namespaces: string[] = []) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(PolicyV1Api);

        try {
            let items: any[] = [];
            if (namespaces.length === 0 || namespaces.includes('all')) {
                const res = await k8sApi.listPodDisruptionBudgetForAllNamespaces();
                items = (res as any).body ? (res as any).body.items : (res as any).items;
            } else {
                const promises = namespaces.map(ns => k8sApi.listNamespacedPodDisruptionBudget({ namespace: ns }));
                const results = await Promise.all(promises);
                items = results.flatMap(res => (res as any).body ? (res as any).body.items : (res as any).items);
            }
            console.log('PDBs found:', items.length);
            return items.map((pdb: any) => ({
                name: pdb.metadata?.name,
                namespace: pdb.metadata?.namespace,
                minAvailable: pdb.spec?.minAvailable,
                maxUnavailable: pdb.spec?.maxUnavailable,
                allowed: pdb.status?.disruptionsAllowed,
                current: pdb.status?.currentHealthy,
                desired: pdb.status?.desiredHealthy,
                age: pdb.metadata?.creationTimestamp,
                metadata: pdb.metadata,
                spec: pdb.spec,
                status: pdb.status
            }));
        } catch (err: any) {
            console.error('Error fetching PDBs:', err);
            return [];
        }
    }

    public async getPodDisruptionBudget(contextName: string, namespace: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(PolicyV1Api);
        try {
            const res = await k8sApi.readNamespacedPodDisruptionBudget({ name, namespace });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching PDB ${namespace}/${name}:`, err);
            return null;
        }
    }

    public async getMutatingWebhookConfigurations(contextName: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AdmissionregistrationV1Api);

        try {
            const res = await k8sApi.listMutatingWebhookConfiguration();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log('MutatingWebhookConfigurations found:', items.length);
            return items.map((mwc: any) => ({
                name: mwc.metadata?.name,
                webhooks: mwc.webhooks?.length || 0,
                age: mwc.metadata?.creationTimestamp,
                metadata: mwc.metadata,
                webhooksRaw: mwc.webhooks
            }));
        } catch (err: any) {
            console.error('Error fetching MutatingWebhookConfigurations:', err);
            return [];
        }
    }

    public async getMutatingWebhookConfiguration(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AdmissionregistrationV1Api);
        try {
            const res = await k8sApi.readMutatingWebhookConfiguration({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching MutatingWebhookConfiguration ${name}:`, err);
            return null;
        }
    }

    public async getValidatingWebhookConfigurations(contextName: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AdmissionregistrationV1Api);

        try {
            const res = await k8sApi.listValidatingWebhookConfiguration();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log('ValidatingWebhookConfigurations found:', items.length);
            return items.map((vwc: any) => ({
                name: vwc.metadata?.name,
                webhooks: vwc.webhooks?.length || 0,
                age: vwc.metadata?.creationTimestamp,
                metadata: vwc.metadata,
                webhooksRaw: vwc.webhooks
            }));
        } catch (err: any) {
            console.error('Error fetching ValidatingWebhookConfigurations:', err);
            return [];
        }
    }

    public async getValidatingWebhookConfiguration(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(AdmissionregistrationV1Api);
        try {
            const res = await k8sApi.readValidatingWebhookConfiguration({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching ValidatingWebhookConfiguration ${name}:`, err);
            return null;
        }
    }

    public async getPriorityClasses(contextName: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(SchedulingV1Api);

        try {
            const res = await k8sApi.listPriorityClass();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log('PriorityClasses found:', items.length);
            return items.map((pc: any) => ({
                name: pc.metadata?.name,
                value: pc.value,
                globalDefault: pc.globalDefault,
                description: pc.description,
                age: pc.metadata?.creationTimestamp,
                metadata: pc.metadata
            }));
        } catch (err: any) {
            console.error('Error fetching PriorityClasses:', err);
            return [];
        }
    }

    public async getPriorityClass(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(SchedulingV1Api);
        try {
            const res = await k8sApi.readPriorityClass({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching PriorityClass ${name}:`, err);
            return null;
        }
    }

    public async getRuntimeClasses(contextName: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(NodeV1Api);

        try {
            const res = await k8sApi.listRuntimeClass();
            const items = (res as any).body ? (res as any).body.items : (res as any).items;
            console.log('RuntimeClasses found:', items.length);
            return items.map((rc: any) => ({
                name: rc.metadata?.name,
                handler: rc.handler,
                age: rc.metadata?.creationTimestamp,
                metadata: rc.metadata
            }));
        } catch (err: any) {
            console.error('Error fetching RuntimeClasses:', err);
            return [];
        }
    }

    public async getRuntimeClass(contextName: string, name: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(NodeV1Api);
        try {
            const res = await k8sApi.readRuntimeClass({ name });
            return (res as any).body ? (res as any).body : res;
        } catch (err) {
            console.error(`Error fetching RuntimeClass ${name}:`, err);
            return null;
        }
    }

    public async getPdbYaml(contextName: string, namespace: string, name: string) {
        const pdb = await this.getPodDisruptionBudget(contextName, namespace, name);
        if (!pdb) return null;
        try {
            return yaml.dump(pdb);
        } catch (e) {
            console.error('Error dumping pdb yaml:', e);
            throw e;
        }
    }

    public async updatePdbYaml(contextName: string, namespace: string, name: string, yamlContent: string) {
        this.kc.setCurrentContext(contextName);
        const k8sApi = this.kc.makeApiClient(PolicyV1Api);

        let newObj: any;
        try {
            newObj = yaml.load(yamlContent);
        } catch (e) {
            throw new Error(`Invalid YAML: ${e}`);
        }

        try {
            const res = await k8sApi.replaceNamespacedPodDisruptionBudget({
                name,
                namespace,
                body: newObj
            });
            return (res as any).body ? (res as any).body : res;
        } catch (error) {
            console.error("Error updating PDB:", error);
            throw error;
        }
    }
    public decodeCertificate(certData: string): CertificateInfo | null {
        try {
            const cert = new crypto.X509Certificate(certData);
            return {
                subject: cert.subject,
                issuer: cert.issuer,
                validFrom: cert.validFrom,
                validTo: cert.validTo,
                serialNumber: cert.serialNumber,
                fingerprint: cert.fingerprint,
                sans: cert.subjectAltName ? cert.subjectAltName.split(',').map(s => s.trim()) : []
            };
        } catch (e) {
            console.error('Failed to decode certificate:', e);
            return null;
        }
    }
}
