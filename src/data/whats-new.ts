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
