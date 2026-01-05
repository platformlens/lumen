export const getDeploymentStatus = (dep: any) => {
    const conditions = dep.status?.conditions || [];

    // Check for specific failure states first
    const replicaFailure = conditions.find((c: any) => c.type === 'ReplicaFailure' && c.status === 'True');
    if (replicaFailure) return { status: 'Failed', color: 'red' };

    const progressing = conditions.find((c: any) => c.type === 'Progressing');
    if (progressing && progressing.status === 'False') return { status: 'Stalled', color: 'red' };

    // If it's progressing but not yet available (rolling update in progress)
    if (progressing && progressing.status === 'True' && dep.status?.updatedReplicas < dep.spec?.replicas) {
        return { status: 'Updating', color: 'blue' };
    }

    // Available check
    const available = conditions.find((c: any) => c.type === 'Available' && c.status === 'True');
    if (available) return { status: 'Active', color: 'green' };
    return { status: 'Pending', color: 'yellow' };
};

export const hasResourceChanged = (prev: any[], current: any[]): boolean => {
    if (prev.length !== current.length) return true;
    // Check if any item has a different resourceVersion or is a different item
    // Assuming order might change or not? Usually API returns consistent order or we sort?
    // But faster to just map by UID or Name.
    // Let's assume standard simple check first:
    // If we just check resourceVersion equality for all items.

    // Better: create a map of prev items
    const prevMap = new Map(prev.map(i => [i.metadata?.uid || i.metadata?.name, i.metadata?.resourceVersion]));

    for (const item of current) {
        const id = item.metadata?.uid || item.metadata?.name;
        const ver = item.metadata?.resourceVersion;
        if (!prevMap.has(id)) return true; // New item
        if (prevMap.get(id) !== ver) return true; // Changed item
    }

    return false;
};

