/**
 * ContextInjector — selects, compresses, and formats context for AI prompts.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3
 */

import { ContextStore } from './context-store';
import { ContextQuery, ResourceSnapshot } from './types';

/** Keyword mappings for inferring resource types from user messages. */
const RESOURCE_TYPE_KEYWORDS: Record<string, string[]> = {
    Pod: ['pod', 'pods', 'container', 'containers', 'crashloop', 'oom', 'restart'],
    Deployment: ['deployment', 'deployments', 'deploy', 'deploys', 'replica', 'replicas', 'rollout'],
    Node: ['node', 'nodes', 'kubelet', 'capacity', 'allocatable'],
};

/** Keywords that indicate the user is asking about problems. */
const PROBLEM_KEYWORDS = [
    'problem', 'problems', 'issue', 'issues', 'error', 'errors',
    'fail', 'failing', 'failed', 'crash', 'crashing', 'crashloop',
    'unhealthy', 'not ready', 'notready', 'pending', 'stuck',
    'oom', 'restart', 'restarting', 'broken', 'down', 'wrong',
];

const SUMMARY_TOKEN_BUDGET = 500;

export class ContextInjector {
    private store: ContextStore;
    private defaultTokenBudget: number;

    constructor(store: ContextStore, defaultTokenBudget: number) {
        this.store = store;
        this.defaultTokenBudget = defaultTokenBudget;
    }

    /** Compress a ResourceSnapshot into a single-line token-efficient string. */
    compressResource(snapshot: ResourceSnapshot): string {
        const ns = snapshot.namespace ? ` ns=${snapshot.namespace}` : '';
        let line = `[${snapshot.kind}] ${snapshot.name}${ns} phase=${snapshot.phase} ready=${snapshot.ready}`;

        if (snapshot.restartCount > 0) {
            line += ` restarts=${snapshot.restartCount}`;
        }

        if (snapshot.replicas) {
            line += ` ready=${snapshot.replicas.ready}/${snapshot.replicas.desired}`;
            if (snapshot.replicas.unavailable > 0) {
                line += ` unavailable=${snapshot.replicas.unavailable}`;
            }
        }

        if (snapshot.resourceUsage) {
            const ru = snapshot.resourceUsage;
            if (ru.cpuRequests) line += ` cpu-req=${ru.cpuRequests}`;
            if (ru.memoryRequests) line += ` mem-req=${ru.memoryRequests}`;
        }

        if (snapshot.warnings.length > 0) {
            line += ` warn=${snapshot.warnings.join(',')}`;
        }

        return line;
    }

    /** Rough token estimate: chars / 4. */
    estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /** Parse user message to determine relevant resource types via keyword matching. */
    inferResourceTypes(message: string): string[] {
        const lower = message.toLowerCase();
        const matched: string[] = [];

        for (const [kind, keywords] of Object.entries(RESOURCE_TYPE_KEYWORDS)) {
            if (keywords.some(kw => lower.includes(kw))) {
                matched.push(kind);
            }
        }

        return matched;
    }

    /** Check if a message is asking about problems/issues. */
    isProblemQuery(message: string): boolean {
        const lower = message.toLowerCase();
        return PROBLEM_KEYWORDS.some(kw => lower.includes(kw));
    }

    /** Check if a resource is unhealthy. */
    private isUnhealthy(r: ResourceSnapshot): boolean {
        return (
            !r.ready ||
            r.phase === 'Failed' ||
            r.phase === 'CrashLoopBackOff' ||
            r.phase === 'NotReady' ||
            r.warnings.length > 0 ||
            (r.replicas !== undefined && r.replicas.unavailable > 0)
        );
    }

    /**
     * Build context string for chat prompts.
     * Selects resources based on user message and query, compresses them,
     * and enforces token budget with priority truncation (unhealthy first).
     */
    buildChatContext(userMessage: string, query?: ContextQuery): string {
        const budget = query?.maxTokens ?? this.defaultTokenBudget;

        // Determine which resources to include
        let resources: ResourceSnapshot[];

        if (query?.resourceTypes && query.resourceTypes.length > 0) {
            resources = query.resourceTypes.flatMap(kind => this.store.getByKind(kind));
        } else {
            const inferred = this.inferResourceTypes(userMessage);
            if (inferred.length > 0) {
                resources = inferred.flatMap(kind => this.store.getByKind(kind));
            } else {
                resources = this.store.getAll();
            }
        }

        // Apply namespace filter
        if (query?.namespaces && query.namespaces.length > 0) {
            const nsSet = new Set(query.namespaces);
            resources = resources.filter(r => r.namespace !== null && nsSet.has(r.namespace));
        }

        // Apply unhealthy-only filter
        if (query?.unhealthyOnly) {
            resources = resources.filter(r => this.isUnhealthy(r));
        }

        // Sort: unhealthy first, then healthy (especially important for problem queries)
        resources.sort((a, b) => {
            const aUnhealthy = this.isUnhealthy(a);
            const bUnhealthy = this.isUnhealthy(b);
            if (aUnhealthy && !bUnhealthy) return -1;
            if (!aUnhealthy && bUnhealthy) return 1;
            return 0;
        });

        // If problem query, prioritize unhealthy — already sorted above

        // Compress and enforce token budget
        const lines: string[] = [];
        let tokenCount = 0;

        for (const resource of resources) {
            const line = this.compressResource(resource);
            const lineTokens = this.estimateTokens(line + '\n');
            if (tokenCount + lineTokens > budget && lines.length > 0) {
                break;
            }
            lines.push(line);
            tokenCount += lineTokens;
        }

        return lines.join('\n');
    }

    /**
     * Build context string for view summaries.
     * Selects resources by type, compresses within 500-token limit.
     */
    buildSummaryContext(resourceType: string, namespace?: string): string {
        let resources: ResourceSnapshot[];

        if (namespace) {
            resources = this.store.getByNamespace(resourceType, namespace);
        } else {
            resources = this.store.getByKind(resourceType);
        }

        // Sort unhealthy first for summaries too
        resources.sort((a, b) => {
            const aUnhealthy = this.isUnhealthy(a);
            const bUnhealthy = this.isUnhealthy(b);
            if (aUnhealthy && !bUnhealthy) return -1;
            if (!aUnhealthy && bUnhealthy) return 1;
            return 0;
        });

        const lines: string[] = [];
        let tokenCount = 0;

        for (const resource of resources) {
            const line = this.compressResource(resource);
            const lineTokens = this.estimateTokens(line + '\n');
            if (tokenCount + lineTokens > SUMMARY_TOKEN_BUDGET && lines.length > 0) {
                break;
            }
            lines.push(line);
            tokenCount += lineTokens;
        }

        return lines.join('\n');
    }

    /** Update the default token budget. */
    setTokenBudget(budget: number): void {
        this.defaultTokenBudget = budget;
    }
}
