export type NodeArchitectureFamily = 'arm' | 'non-arm' | 'unknown';

export interface NodeArchitecture {
    architecture: string;
    family: NodeArchitectureFamily;
}

export function resolveNodeArchitecture(labels?: Record<string, string>): string {
    const currentArchitecture = labels?.['kubernetes.io/arch']?.trim().toLowerCase();
    const legacyArchitecture = labels?.['beta.kubernetes.io/arch']?.trim().toLowerCase();
    return currentArchitecture || legacyArchitecture || 'unknown';
}

export function classifyNodeArchitecture(architecture: string): NodeArchitectureFamily {
    if (architecture === 'unknown') return 'unknown';
    return architecture.startsWith('arm') ? 'arm' : 'non-arm';
}

export function getNodeArchitecture(labels?: Record<string, string>): NodeArchitecture {
    const architecture = resolveNodeArchitecture(labels);
    return { architecture, family: classifyNodeArchitecture(architecture) };
}
