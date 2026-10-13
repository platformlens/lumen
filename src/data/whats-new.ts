export interface WhatsNewSection {
    title: string;
    colorAccent: string;
    items: string[];
}

export interface WhatsNewRelease {
    version: string;
    title: string;
    description: string;
    sections: WhatsNewSection[];
}

export const WHATS_NEW_RELEASES: WhatsNewRelease[] = [
    {
        version: '0.0.9',
        title: 'Version 0.0.9',
        description: 'Background resource cache, Crossplane, Deployment Full View, cluster rename, and multi-terminal support.',
        sections: [
            {
                title: 'Faster, always-live resources',
                colorAccent: 'bg-cyan-500',
                items: [
                    'Deployments, pods, secrets, configmaps, services and Helm releases now load once per cluster and stay live in the background',
                    'Switching tabs or namespaces no longer reloads data or restarts watches',
                    'Status banners explain reconnecting, error and forbidden states while keeping loaded rows visible',
                    'Watches resync automatically when the window regains focus or your machine wakes from sleep',
                ],
            },
            {
                title: 'Crossplane',
                colorAccent: 'bg-purple-500',
                items: [
                    'New read-only Crossplane section, shown only when Crossplane is detected in the cluster',
                    'Overview, Packages, Definitions, Composites and Managed resource views',
                    'Detail drawer with health banner, reference links and a Claim → XR → managed resource graph',
                ],
            },
            {
                title: 'Deployments & clusters',
                colorAccent: 'bg-green-500',
                items: [
                    'New Full View for deployments: rollout, revisions, pod distribution, containers, networking and security posture on one page',
                    'Compare pod-template changes between revisions',
                    'Right-click a cluster to rename its kube context — pins, tabs, watchers and terminals follow',
                    'Contexts added to your kubeconfig appear without restarting Lumen',
                    'The custom kubeconfig path in Settings is now honored',
                ],
            },
            {
                title: 'Nodes, YAML & terminals',
                colorAccent: 'bg-blue-500',
                items: [
                    'New ARM / non-ARM / unknown architecture chart on the Nodes page',
                    'Nodes table is always reachable, even with Stats expanded or in short windows',
                    'Unsaved YAML edits are kept per tab across tab switches, pop-out and refreshes',
                    'Open multiple terminal tabs, each bound to the cluster context it was opened with',
                    'Cordon and drain now target the right cluster without changing your global kubectl context',
                ],
            },
            {
                title: 'Bug fixes',
                colorAccent: 'bg-orange-500',
                items: [
                    'Fixed YAML tabs saving to the wrong cluster',
                    'Fixed event listener leaks and stale watchers after cluster switches',
                    'Fixed inconsistent data when selecting multiple namespaces',
                ],
            },
        ],
    },
    {
        version: '0.0.8',
        title: 'Version 0.0.8',
        description: 'Agentic AI debugging, AWS settings overhaul, cluster quick-switch, and real node metrics.',
        sections: [
            {
                title: 'Agentic AI debugging',
                colorAccent: 'bg-cyan-500',
                items: [
                    'AI assistant can now run kubectl commands against your cluster to debug issues with real data',
                    'Human-in-the-loop approval — Allow, Allow & Trust, or Deny each tool call',
                    'Trusted command prefixes for auto-approval — manage them in Settings → AI Models',
                    'Safety guardrails — dangerous commands are always blocked, read-only mode available',
                    'Works with AWS Bedrock (Claude), Google Gemini, and local LLMs',
                ],
            },
            {
                title: 'Settings & status bar',
                colorAccent: 'bg-green-500',
                items: [
                    'AWS credentials moved to a dedicated settings section with full Granted integration',
                    'Click the cluster name in the status bar to quickly switch clusters',
                    'AWS profile indicator in the status bar with quick-switch support',
                    'Mute button to silence anomaly notifications on noisy clusters',
                ],
            },
            {
                title: 'Node monitoring',
                colorAccent: 'bg-blue-500',
                items: [
                    'Node CPU and memory columns now show real usage from metrics-server',
                    'Node stats cards and charts update in real-time from the node watcher',
                ],
            },
            {
                title: 'Bug fixes',
                colorAccent: 'bg-orange-500',
                items: [
                    'Fixed app logo not appearing in production builds (sidebar, splash, settings)',
                    'Fixed macOS dock icon losing rounded corners with new logo',
                    'Fixed node delete crashing the UI',
                ],
            },
        ],
    },
    {
        version: '0.0.7',
        title: 'Version 0.0.7',
        description: 'Revamped AI assistance, account sign-in, and local LLM support.',
        sections: [
            {
                title: 'AI & productivity',
                colorAccent: 'bg-cyan-500',
                items: [
                    'Revamped AI assistance for a clearer, faster troubleshooting and analysis experience',
                    'Add support for local LLMs — use an OpenAI-compatible endpoint for private, offline-capable AI',
                ],
            },
            {
                title: 'Accounts',
                colorAccent: 'bg-green-500',
                items: [
                    'Account login and registration — sign in to sync preferences and access org features',
                ],
            },
        ],
    },
    {
        version: '0.0.6-patch1',
        title: 'Version 0.0.6 — Patch 1',
        description: 'Theme support, log search, user accounts, Helm diffs and more.',
        sections: [
            {
                title: 'Patch Fixes',
                colorAccent: 'bg-cyan-500',
                items: [
                    'Deployment revision history — view all ReplicaSet revisions directly in the deployment drawer',
                    'Revision diff comparison — select any two revisions and compare changes side-by-side with a full-screen Monaco diff editor',
                    'Fix resources not being cleaned up correctly when switching between clusters',
                    'Fix Helm uninstall by moving to child process execution for improved reliability',
                ],
            },
            {
                title: 'Performance',
                colorAccent: 'bg-blue-500',
                items: [
                    'Further performance improvements and enhancements to app performance',
                ],
            },
            {
                title: 'New Features',
                colorAccent: 'bg-green-500',
                items: [
                    'Ability to search for logs and download logs',
                    'User sign up and registration support including support to create orgs and teams. More features coming soon in this area',
                    'Custom helm charts view — see diffs, changes and rollbacks',
                    'Add full view editor support',
                    'Add Keda Scaled Object custom drawer support',
                ],
            },
            {
                title: 'UI Improvements',
                colorAccent: 'bg-purple-500',
                items: [
                    'UX/UI refinements and default charcoal mode with theme support',
                ],
            },
            {
                title: 'Bug Fixes',
                colorAccent: 'bg-orange-500',
                items: [
                    'Fix incorrectly shown pod counts',
                    'Fix JS errors on app close',
                ],
            },
        ],
    },
    {
        version: '0.0.6',
        title: 'Version 0.0.6',
        description: 'Theme support, log search, user accounts, Helm diffs and more.',
        sections: [
            {
                title: 'Performance',
                colorAccent: 'bg-blue-500',
                items: [
                    'Further performance improvements and enhancements to app performance',
                ],
            },
            {
                title: 'New Features',
                colorAccent: 'bg-green-500',
                items: [
                    'Ability to search for logs and download logs',
                    'User sign up and registration support including support to create orgs and teams. More features coming soon in this area',
                    'Custom helm charts view — see diffs, changes and rollbacks',
                    'Add full view editor support',
                    'Add Keda Scaled Object custom drawer support',
                ],
            },
            {
                title: 'UI Improvements',
                colorAccent: 'bg-purple-500',
                items: [
                    'UX/UI refinements and default charcoal mode with theme support',
                ],
            },
            {
                title: 'Bug Fixes',
                colorAccent: 'bg-orange-500',
                items: [
                    'Fix incorrectly shown pod counts',
                    'Fix JS errors on app close',
                ],
            },
        ],
    },
    {
        version: '0.0.5',
        title: 'Version 0.0.5',
        description: 'Performance enhancements, security audit viewing, UI refinements and more.',
        sections: [
            {
                title: 'Performance Enhancements',
                colorAccent: 'bg-blue-500',
                items: [
                    'Addition of worker threads to reduce load on the main thread. Reduces visible lag making overall application smoother.',
                ],
            },
            {
                title: 'UI Improvements',
                colorAccent: 'bg-purple-500',
                items: [
                    'Refine the UI to fill more available whitespace',
                    'Removal of boxes around tables and dash view',
                    'Ability to adjust font size for header, sidebar, pinned items and table items',
                    'Fix various other UI issues.',
                ],
            },
            {
                title: 'Security Features',
                colorAccent: 'bg-orange-500',
                items: [
                    'Now able to audit who did what command within a kubernetes cluster on AWS',
                    'Simply select verb, filter by user or system account and hit search. No need to pop to management console to quickly diagnose issues or missing deployments.',
                ],
            },
            {
                title: 'General Features',
                colorAccent: 'bg-green-500',
                items: [
                    'Add support to delete any resource',
                    'Fix bug in logs view where logs would constantly scroll to the bottom as new logs arrived',
                    'Add search capability in logs.',
                ],
            },
        ],
    },
];
