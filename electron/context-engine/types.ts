/**
 * Shared types for the AI Context Engine.
 * Requirements: 1.4, 5.1
 */

/** Summary of a single Kubernetes resource condition. */
export interface ConditionSummary {
    type: string;
    status: string;
    reason?: string;
    message?: string;
}

/** Compressed snapshot of a Kubernetes resource's status-relevant fields. */
export interface ResourceSnapshot {
    kind: string;                  // "Pod", "Deployment", "Node"
    name: string;
    namespace: string | null;      // null for cluster-scoped resources
    phase: string;                 // "Running", "Pending", "Failed", etc.
    conditions: ConditionSummary[];
    restartCount: number;          // sum of container restart counts (pods)
    ready: boolean;
    age: string;                   // ISO timestamp of creation
    resourceUsage?: {
        cpuRequests: string;
        memoryRequests: string;
        cpuLimits: string;
        memoryLimits: string;
    };
    replicas?: {                   // for deployments/statefulsets
        desired: number;
        ready: number;
        unavailable: number;
    };
    warnings: string[];            // recent warning events or status messages
}

/** Configuration for the Context Engine. */
export interface ContextEngineConfig {
    tokenBudget: number;              // max tokens for context injection (default: 2000)
    summariesEnabled: boolean;        // enable/disable view summaries
    anomalyDetectionEnabled: boolean; // enable/disable anomaly alerts
}

/** Query parameters for filtering context injection. */
export interface ContextQuery {
    resourceTypes?: string[];      // filter by kind
    namespaces?: string[];         // filter by namespace
    unhealthyOnly?: boolean;       // prioritize problems
    maxTokens?: number;            // override default budget
}

/** A detected anomaly in the cluster. */
export interface Anomaly {
    id: string;                    // deterministic: `${kind}/${namespace}/${name}/${type}`
    resource: ResourceSnapshot;
    type: string;                  // "CrashLoopBackOff", "OOMKilled", "NodeNotReady", etc.
    severity: 'critical' | 'warning' | 'info';
    message: string;
    detectedAt: number;
}

/** A rule that evaluates a resource for anomalous conditions. */
export interface AnomalyRule {
    name: string;
    evaluate(resource: ResourceSnapshot): Anomaly | null;
}

/** A single message in a chat conversation. */
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

/** A chat session between the user and the AI assistant. */
export interface ChatSession {
    id: string;
    messages: ChatMessage[];
    resourceContext?: { name: string; type: string; namespace?: string };
    clusterContext?: string;
    model: string;
    provider: string;
    createdAt: number;
    updatedAt: number;
}

/** A stat box for the view summary UI. */
export interface SummaryStatBox {
    label: string;
    value: number;
    color: 'green' | 'yellow' | 'red' | 'blue' | 'gray';
}

/** Structured data returned by getSummary for rich UI rendering. */
export interface ViewSummaryData {
    text: string;                  // Human-readable summary sentence
    stats: SummaryStatBox[];       // Stat boxes for quick glance
    issues: string[];              // Individual issue descriptions
    fromCache: boolean;
}

