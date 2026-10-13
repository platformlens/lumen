/** A kube context as listed in the cluster list (name is the kubeconfig context name). */
export interface ClusterContextInfo {
    name: string;
    cluster: string;
    user: string;
    namespace?: string;
}

/** Payload of the `k8s:contextsChanged` event emitted when the kubeconfig contexts change on disk. */
export interface ContextsChangedPayload {
    contexts: ClusterContextInfo[];
    added: string[];
    removed: string[];
}

/** Result of renaming a kube context (discriminated so errors carry a user-facing message). */
export type RenameClusterResult =
    | { ok: true; newName: string; clusters: ClusterContextInfo[]; pinnedClusters: string[] }
    | { ok: false; error: string };
