import { useState, useEffect, useCallback } from 'react';

export const usePortForwarding = (
    resource: any,
    kind: 'Service' | 'Pod',
    clusterName?: string
) => {
    const [selectedPort, setSelectedPort] = useState<{ port: number; targetPort: any } | null>(null);
    const [activeForwards, setActiveForwards] = useState<{ [key: string]: { id: string; localPort: number; targetPort: number; resourceType: string } }>({});

    const fetchForwards = useCallback(async () => {
        if (!resource || !resource.metadata) return;

        try {
            const forwards = await window.k8s.getActivePortForwards();
            // Filter for this resource
            const myForwards = forwards.filter((f: any) =>
                f.namespace === resource.metadata.namespace &&
                f.serviceName === resource.metadata.name &&
                f.resourceType === kind.toLowerCase()
            );

            const myActive: { [key: string]: any } = {};
            myForwards.forEach((f: any) => {
                // Use inputPort if available (for exact match with what UI sent), otherwise fallback to targetPort
                const key = f.inputPort !== undefined ? `${f.inputPort}` : `${f.targetPort}`;
                myActive[key] = f;
            });
            setActiveForwards(myActive);
        } catch (err) {
            console.error("Failed to sync forwards", err);
        }
    }, [resource, kind]);

    // Sync active forwards on mount/update
    useEffect(() => {
        fetchForwards();
    }, [fetchForwards]);

    const handleStartForward = async (localPort: number) => {
        if (!clusterName || !resource) {
            console.error("Cluster name or resource missing");
            return;
        }

        const targetPort = selectedPort?.targetPort || selectedPort?.port;

        try {
            const result = await window.k8s.startPortForward(
                clusterName,
                resource.metadata.namespace,
                resource.metadata.name,
                targetPort,
                localPort,
                kind.toLowerCase() as 'service' | 'pod'
            );

            // Auto open active browser
            const url = `http://localhost:${result.localPort}`;
            window.k8s.openExternal(url);

            // Refresh state from backend
            await fetchForwards();

        } catch (err) {
            console.error("Failed to start port forward", err);
        } finally {
            setSelectedPort(null);
        }
    };

    const handleStopForward = async (targetPort: number | string) => {
        const portKey = `${targetPort}`;
        const forward = activeForwards[portKey];
        if (!forward) return;

        try {
            await window.k8s.stopPortForward(forward.id);
            // Refresh state from backend to ensure we are in sync
            await fetchForwards();
        } catch (err) {
            console.error("Failed to stop", err);
        }
    };

    return {
        selectedPort,
        setSelectedPort,
        activeForwards,
        handleStartForward,
        handleStopForward,
        fetchForwards
    };
};
