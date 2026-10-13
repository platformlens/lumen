/**
 * Builds the pod-shaped log target App.handleOpenLogs expects, so the LogViewer
 * container selector lists every container (main, sidecar and init).
 */
import type { DeploymentPodSummary, PodTemplate } from '../types/deployment-details';

export interface LogTarget {
    name: string; namespace: string;
    spec: { containers: { name: string }[]; initContainers: { name: string }[] };
}

/**
 * containers = kind 'main'; initContainers = kind 'init' and 'sidecar' (sidecars are init containers in the spec).
 * When pod.containers is empty, falls back to the template's containers/initContainers names.
 */
export function toLogTarget(pod: DeploymentPodSummary, template: PodTemplate): LogTarget {
    if (pod.containers.length > 0) {
        return {
            name: pod.name,
            namespace: pod.namespace,
            spec: {
                containers: pod.containers.filter(c => c.kind === 'main').map(c => ({ name: c.name })),
                initContainers: pod.containers.filter(c => c.kind !== 'main').map(c => ({ name: c.name })),
            },
        };
    }
    return {
        name: pod.name,
        namespace: pod.namespace,
        spec: {
            containers: (template.spec?.containers ?? []).map(c => ({ name: c.name })),
            initContainers: (template.spec?.initContainers ?? []).map(c => ({ name: c.name })),
        },
    };
}

/** First kind 'main' entry of pod.containers, else template.spec.containers[0].name, else ''. */
export function firstMainContainerName(pod: DeploymentPodSummary, template: PodTemplate): string {
    const main = pod.containers.find(c => c.kind === 'main');
    if (main) return main.name;
    return template.spec?.containers?.[0]?.name ?? '';
}
