
export const isEksCluster = (nodes: any[]): boolean => {
    if (!nodes || nodes.length === 0) return false;
    // Check for EKS-specific labels on nodes
    return nodes.some(node => {
        const labels = node.metadata?.labels || {};
        return Object.keys(labels).some(key => key.includes('eks.amazonaws.com'));
    });
};

export const getNodeProviderInfo = (node: any) => {
    const labels = node.metadata?.labels || {};

    return {
        instanceType: labels['node.kubernetes.io/instance-type'] || 'Unknown',
        capacityType: labels['eks.amazonaws.com/capacityType'] || labels['karpenter.sh/capacity-type'] || 'ON_DEMAND',
        zone: labels['topology.kubernetes.io/zone'] || labels['failure-domain.beta.kubernetes.io/zone'] || '-',
        region: labels['topology.kubernetes.io/region'] || labels['failure-domain.beta.kubernetes.io/region'] || '-',
        isSpot: (labels['eks.amazonaws.com/capacityType'] || labels['karpenter.sh/capacity-type'] || '').toLowerCase() === 'spot'
    };
};

export const formatMemory = (memory: string): string => {
    if (!memory) return '-';

    // Parse Kubernetes memory string (e.g., "32931584Ki", "8Gi", "100Mi")
    const value = parseInt(memory, 10);
    const unit = memory.replace(/[0-9]/g, '');

    if (isNaN(value)) return memory;

    let bytes = 0;

    switch (unit) {
        case 'Ki': bytes = value * 1024; break;
        case 'Mi': bytes = value * 1024 * 1024; break;
        case 'Gi': bytes = value * 1024 * 1024 * 1024; break;
        case 'Ti': bytes = value * 1024 * 1024 * 1024 * 1024; break;
        case 'm': bytes = value / 1000; break; // milli-bytes? unlikely for memory but good to be safe
        default: bytes = value; // Assume bytes if no unit
    }

    const gb = bytes / (1024 * 1024 * 1024);

    // Format to 1 decimal place, or 2 if < 1
    if (gb < 1) return `${gb.toFixed(2)} GB`;
    return `${gb.toFixed(1)} GB`;
};
