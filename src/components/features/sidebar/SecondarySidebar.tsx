import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Tooltip } from '../../shared/Tooltip';
import {
    LayoutGrid,
    Box,
    Layers,
    Copy,
    ChevronDown,
    ChevronRight,
    Search,
    Server,
    Network,
    Shield,
    Users,
    Puzzle,
    X,
    Ghost,
    Database,
    Play,
    Clock,
    Globe,
    Share2,
    HardDrive,
    ShieldCheck,
    File,
    Key,
    TrendingUp,
    Webhook,
    Star,
    Cpu,
    ChevronLeft,
    Loader2,
    Pin
} from 'lucide-react';
import { clsx } from 'clsx';

interface SecondarySidebarProps {
    mode: 'clusters' | 'resources' | 'settings';
    onSelectView: (view: string) => void;
    activeView: string;
    // For cluster mode
    selectedCluster?: string | null;
    onSelectCluster?: (clusterName: string) => void;
    onBack?: () => void;
    // Connection State
    connectionStatus?: 'idle' | 'connecting' | 'connected' | 'error';
    attemptedCluster?: string | null;
    isEks?: boolean;
    hasCertManager?: boolean;
    // Pinned Clusters
    pinnedClusters?: string[];
    onTogglePin?: (clusterName: string) => void;
}

interface MenuItem {
    label: string;
    view: string;
    icon: React.ReactNode;
    comingSoon?: boolean;
}

interface MenuGroup {
    id: string;
    title: string;
    items: MenuItem[];
}

const NavItem = ({ icon, label, active, onClick, onContextMenu, hasSub = false, comingSoon = false, isLoading = false, loadingText }: any) => (
    <div
        onClick={isLoading ? undefined : onClick}
        onContextMenu={isLoading ? undefined : onContextMenu}
        className={clsx(
            "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm",
            active ? "bg-[#2a2a2a] text-blue-400 font-medium" : "text-gray-400 hover:bg-[#2a2a2a] hover:text-gray-200",
            comingSoon && "opacity-50 cursor-not-allowed",
            isLoading && "opacity-80 cursor-wait"
        )}
    >
        {isLoading ? <Loader2 size={18} className="animate-spin text-blue-400" /> : icon}
        <span className="flex-1 truncate">{isLoading && loadingText ? loadingText : label}</span>
        {hasSub && <ChevronRight size={14} className="text-gray-600" />}
        {comingSoon && <span className="text-[10px] bg-gray-800 text-gray-400 px-1 py-0.5 rounded">Soon</span>}
    </div>
);

const SidebarGroup = ({ title, isOpen, onToggle, children }: any) => (
    <div className="px-3 mt-2">
        <div
            className="flex items-center justify-between px-2 py-1.5 text-gray-400 hover:text-white cursor-pointer group"
            onClick={onToggle}
        >
            <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>

        {isOpen && (
            <div className="mt-1 ml-2 pl-2 border-l border-[#333] space-y-0.5">
                {children}
            </div>
        )}
    </div>
);

export const SecondarySidebar: React.FC<SecondarySidebarProps> = ({
    mode,
    onSelectView,
    activeView,
    selectedCluster,
    onSelectCluster,
    onBack,
    connectionStatus,
    attemptedCluster,
    isEks,
    hasCertManager,
    pinnedClusters = [],
    onTogglePin
}) => {
    const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; cluster: string } | null>(null);

    // Close context menu on click elsewhere
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    const handleContextMenu = (e: React.MouseEvent, clusterName: string) => {
        e.preventDefault();

        // Menu dimensions
        const menuWidth = 160;
        const menuHeight = 50;

        // Calculate position - position close to cursor with smart flipping
        let x = e.clientX + 2; // Small offset from cursor
        let y = e.clientY + 2;

        // If too close to right edge, show menu to the left of cursor
        if (x + menuWidth > window.innerWidth) {
            x = e.clientX - menuWidth - 2;
        }

        // If too close to bottom edge, show menu above cursor
        if (y + menuHeight > window.innerHeight) {
            y = e.clientY - menuHeight - 2;
        }

        setContextMenu({
            visible: true,
            x,
            y,
            cluster: clusterName
        });
    };
    const [openGroups, setOpenGroups] = useState<{ [key: string]: boolean }>({
        'workloads': true,
        'certificates': true,
        'network': false,
        'storage': false,
        'access': false,
        'config': false,
        'crd': false
    });
    const [clusters, setClusters] = useState<any[]>([]);
    const [crds, setCrds] = useState<any[]>([]);
    const [loadingCrds, setLoadingCrds] = useState(false);
    const [expandedApiGroups, setExpandedApiGroups] = useState<{ [key: string]: boolean }>({});
    const [searchQuery, setSearchQuery] = useState('');

    const toggleApiGroup = (group: string) => {
        setExpandedApiGroups(prev => ({
            ...prev,
            [group]: !prev[group]
        }));
    };

    useEffect(() => {
        if (mode === 'clusters') {
            window.k8s.getClusters().then(setClusters).catch(console.error);
        }
    }, [mode]);

    useEffect(() => {
        if (openGroups['crd'] && crds.length === 0 && selectedCluster) {
            setLoadingCrds(true);
            window.k8s.getCRDs(selectedCluster)
                .then(setCrds)
                .catch(err => console.error("Failed to fetch CRDs", err))
                .finally(() => setLoadingCrds(false));
        }
    }, [openGroups['crd'], selectedCluster]);

    // Auto-expand group if active view is a CRD
    useEffect(() => {
        if (activeView && activeView.startsWith('crd/')) {
            const parts = activeView.split('/');
            // Format: crd/group/version/plural
            // Example: crd/cert-manager.io/v1/certificates
            if (parts.length >= 2) {
                const group = parts[1];
                setExpandedApiGroups(prev => {
                    if (prev[group]) return prev;
                    return { ...prev, [group]: true };
                });
                // Ensure main CRD group is open too
                setOpenGroups(prev => {
                    if (prev['crd']) return prev;
                    return { ...prev, 'crd': true };
                });
            }
        }
    }, [activeView]);

    // Auto-expand all groups when searching
    useEffect(() => {
        if (searchQuery) {
            setOpenGroups(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(key => next[key] = true);
                return next;
            });
            // Also expand all API groups if query is long enough
            if (searchQuery.length > 2) {
                setExpandedApiGroups(prev => {
                    // This is a bit brute force, ideally we only open ones with matches
                    // But for now let's leave it to the user or implement smarter logic below
                    return prev;
                });
            }
        }
    }, [searchQuery]);


    const toggleGroup = (group: string) => {
        setOpenGroups(prev => ({ ...prev, [group]: !prev[group] }));
    }

    // Filter Logic
    const filterMatches = (text: string) => text.toLowerCase().includes(searchQuery.toLowerCase());

    const filteredClusters = clusters.filter(c => filterMatches(c.name));

    // Standard Menu Data
    const STANDARD_MENU: MenuGroup[] = [
        {
            id: 'workloads',
            title: 'Workloads',
            items: [
                { label: 'Pods', view: 'pods', icon: <Box size={18} /> },
                { label: 'Deployments', view: 'deployments', icon: <Layers size={18} /> },

                { label: 'DaemonSets', view: 'daemonsets', icon: <Ghost size={18} /> },
                { label: 'StatefulSets', view: 'statefulsets', icon: <Database size={18} /> },
                { label: 'ReplicaSets', view: 'replicasets', icon: <Copy size={18} /> },
                { label: 'Jobs', view: 'jobs', icon: <Play size={18} /> },
                { label: 'CronJobs', view: 'cronjobs', icon: <Clock size={18} /> },
            ]
        },
        {
            id: 'network',
            title: 'Network',
            items: [
                { label: 'Services', view: 'services', icon: <Network size={18} /> },
                { label: 'Endpoint Slices', view: 'endpointslices', icon: <Share2 size={18} /> },
                { label: 'Endpoints', view: 'endpoints', icon: <Share2 size={18} /> },
                { label: 'Ingresses', view: 'ingresses', icon: <Globe size={18} /> },
                { label: 'Ingress Classes', view: 'ingressclasses', icon: <Globe size={18} /> },
                { label: 'Network Policies', view: 'networkpolicies', icon: <ShieldCheck size={18} /> },
            ]
        },
        {
            id: 'storage',
            title: 'Storage',
            items: [
                { label: 'Persistent Volume Claims', view: 'persistentvolumeclaims', icon: <HardDrive size={18} /> },
                { label: 'Persistent Volumes', view: 'persistentvolumes', icon: <HardDrive size={18} /> },
                { label: 'Storage Classes', view: 'storageclasses', icon: <Database size={18} /> },
            ]
        },
        {
            id: 'config',
            title: 'Config',
            items: [
                { label: 'ConfigMaps', view: 'configmaps', icon: <File size={18} /> },
                { label: 'Secrets', view: 'secrets', icon: <Key size={18} /> },
                { label: 'Horizontal Pod Autoscalers', view: 'horizontalpodautoscalers', icon: <TrendingUp size={18} /> },
                { label: 'Pod Disruption Budgets', view: 'poddisruptionbudgets', icon: <Shield size={18} /> },
                { label: 'Mutating Webhook Configs', view: 'mutatingwebhookconfigurations', icon: <Webhook size={18} /> },
                { label: 'Validating Webhook Configs', view: 'validatingwebhookconfigurations', icon: <ShieldCheck size={18} /> },
                { label: 'Priority Classes', view: 'priorityclasses', icon: <Star size={18} /> },
                { label: 'Runtime Classes', view: 'runtimeclasses', icon: <Cpu size={18} /> },
            ]
        },
        {
            id: 'access',
            title: 'Access Control',
            items: [
                { label: 'Cluster Roles', view: 'clusterroles', icon: <Shield size={18} /> },
                { label: 'Cluster Role Bindings', view: 'clusterrolebindings', icon: <Shield size={18} /> },
                { label: 'Roles', view: 'roles', icon: <Users size={18} /> },
                { label: 'Role Bindings', view: 'rolebindings', icon: <Users size={18} /> },
                { label: 'Service Accounts', view: 'serviceaccounts', icon: <Users size={18} /> },
            ]
        }
    ];

    if (hasCertManager) {
        STANDARD_MENU.splice(1, 0, { // Insert after Workloads (index 0+1=1? No, Network is 1. Insert at 1 -> Network becomes 2)
            // Or maybe after Network?
            // User requested "Certificates"
            id: 'certificates',
            title: 'Certificates',
            items: [
                { label: 'Cert Manager', view: 'certificates', icon: <Shield size={18} /> }
            ]
        });
    }

    // Filter CRDs
    const filteredCrds = crds.filter(crd =>
        filterMatches(crd.name) ||
        filterMatches(crd.group) ||
        filterMatches(crd.kind)
    );

    const hasCrdMatches = filteredCrds.length > 0;

    return (
        <>
            <div className="w-64 h-full bg-transparent flex flex-col">
                <div className="p-4 border-b border-white/5">
                    <div className="bg-white/5 rounded px-3 py-1.5 flex items-center gap-2 border border-white/10 focus-within:border-blue-500/50 focus-within:bg-blue-500/5 transition-colors">
                        <Search size={14} className="text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search..."
                            className="bg-transparent border-none outline-none text-sm text-gray-200 placeholder-gray-500 w-full"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="text-gray-500 hover:text-white transition-colors p-0.5 hover:bg-white/10 rounded"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto py-2 pb-4">

                    {mode === 'clusters' && (
                        <div className="px-3">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-2">Clusters</h3>
                            <div className="space-y-0.5">
                                {filteredClusters.map(c => (
                                    <NavItem
                                        key={c.name}
                                        icon={<Server size={18} />}
                                        label={c.name}
                                        active={selectedCluster === c.name}
                                        isLoading={connectionStatus === 'connecting' && attemptedCluster === c.name}
                                        loadingText="Logging in..."
                                        onClick={() => {
                                            if (onSelectCluster) {
                                                setSearchQuery(''); // Clear search on select
                                                onSelectCluster(c.name);
                                            }
                                        }}
                                        onContextMenu={(e: React.MouseEvent) => handleContextMenu(e, c.name)}
                                    />
                                ))}
                                {filteredClusters.length === 0 && (
                                    <div className="px-3 py-2 text-sm text-gray-500 italic">No clusters found</div>
                                )}
                            </div>
                        </div>
                    )}

                    {mode === 'resources' && (
                        <>
                            {/* Top Level Items */}
                            <div className="px-3 mb-2">
                                {/* Back / Cluster Info */}
                                {selectedCluster && (
                                    <div className="mb-4">
                                        <div
                                            onClick={onBack}
                                            className="flex items-center gap-2 text-gray-400 hover:text-white cursor-pointer group mb-1 px-2"
                                        >
                                            <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
                                            <span className="text-xs font-medium uppercase tracking-wider">Back to Clusters</span>
                                        </div>
                                        <div className="px-2 flex items-center gap-2 text-white font-bold text-lg truncate">
                                            <Server size={16} className="text-blue-400" />
                                            <span className="truncate flex-1">{selectedCluster}</span>
                                            {isEks && (
                                                <span className="px-1.5 py-0.5 text-[0.65rem] bg-[#FF9900]/10 text-[#FF9900] border border-[#FF9900]/20 rounded font-medium tracking-wide">
                                                    EKS
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {(!searchQuery || filterMatches('Overview')) && (
                                    <>
                                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-2">Cluster</h3>
                                        <NavItem
                                            icon={<LayoutGrid size={18} />}
                                            label="Overview"
                                            active={activeView === 'overview'}
                                            onClick={() => onSelectView('overview')}
                                        />
                                    </>
                                )}
                                {(!searchQuery || filterMatches('Nodes')) && (
                                    <NavItem
                                        icon={<Server size={18} />}
                                        label="Nodes"
                                        active={activeView === 'nodes'}
                                        onClick={() => onSelectView('nodes')}
                                    />
                                )}
                                {(!searchQuery || filterMatches('Namespaces')) && (
                                    <NavItem
                                        icon={<Layers size={18} />}
                                        label="Namespaces"
                                        active={activeView === 'namespaces'}
                                        onClick={() => onSelectView('namespaces')}
                                    />
                                )}
                                {isEks && (!searchQuery || filterMatches('AWS')) && (
                                    <NavItem
                                        icon={<Shield size={18} />} // Or another icon like 'Cloud' or 'Globe'
                                        label="AWS"
                                        active={activeView === 'aws'}
                                        onClick={() => onSelectView('aws')}
                                    />
                                )}
                            </div>

                            {/* Standard Groups */}
                            {STANDARD_MENU.map(group => {
                                const filteredItems = group.items.filter(item => filterMatches(item.label));
                                if (searchQuery && filteredItems.length === 0) return null;

                                return (
                                    <SidebarGroup
                                        key={group.id}
                                        title={group.title}
                                        isOpen={openGroups[group.id]}
                                        onToggle={() => toggleGroup(group.id)}
                                    >
                                        {(searchQuery ? filteredItems : group.items).map(item => (
                                            <NavItem
                                                key={item.view}
                                                icon={item.icon}
                                                label={item.label}
                                                active={activeView === item.view}
                                                onClick={() => onSelectView(item.view)}
                                                comingSoon={item.comingSoon}
                                            />
                                        ))}
                                    </SidebarGroup>
                                );
                            })}

                            {/* Custom Resources Group */}
                            {(hasCrdMatches || (!searchQuery)) && (
                                <SidebarGroup
                                    title="Custom Resources"
                                    isOpen={openGroups['crd']}
                                    onToggle={() => toggleGroup('crd')}
                                >
                                    {loadingCrds && (
                                        <div className="px-3 py-2 text-xs text-gray-500 italic flex items-center gap-2">
                                            <div className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin"></div>
                                            Loading definitions...
                                        </div>
                                    )}

                                    {!loadingCrds && (
                                        <>
                                            {/* Definitions View */}
                                            {(!searchQuery || filterMatches('Definitions')) && (
                                                <NavItem
                                                    icon={<Puzzle size={16} />}
                                                    label="Definitions"
                                                    active={activeView === 'crd-definitions'}
                                                    onClick={() => onSelectView('crd-definitions')}
                                                />
                                            )}

                                            {/* Grouped CRDs */}
                                            {Object.entries(filteredCrds.reduce((acc: any, crd: any) => {
                                                const group = crd.group || 'Other';
                                                if (!acc[group]) acc[group] = [];
                                                acc[group].push(crd);
                                                return acc;
                                            }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([group, groupCrds]: [string, any]) => {
                                                const isExpanded = expandedApiGroups[group] || searchQuery.length > 0; // Auto expand on search

                                                // Calculate if the group itself matches or if children match
                                                // Since we already filtered 'filteredCrds', we know 'groupCrds' contains matches.
                                                // The group name itself might match, or children.

                                                return (
                                                    <div key={group} className="mt-2">
                                                        <div
                                                            className="px-3 py-1 flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase cursor-pointer hover:text-gray-300 transition-colors select-none group/item"
                                                            onClick={() => toggleApiGroup(group)}
                                                        >
                                                            <div className="shrink-0 flex items-center justify-center">
                                                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                            </div>
                                                            <Tooltip
                                                                content={group}
                                                                placement="top"
                                                                delay={400}
                                                                className="min-w-0 flex-1 truncate block"
                                                            >
                                                                <span className="truncate block">{group}</span>
                                                            </Tooltip>
                                                        </div>

                                                        {isExpanded && (
                                                            <div className="pl-2 border-l border-[#333] ml-3 mt-1 space-y-0.5">
                                                                {groupCrds.map((crd: any) => (
                                                                    <NavItem
                                                                        key={crd.name}
                                                                        icon={<Box size={14} />}
                                                                        label={crd.kind}
                                                                        active={activeView === `crd/${crd.group}/${crd.versions[0]}/${crd.plural}`}
                                                                        onClick={() => onSelectView(`crd/${crd.group}/${crd.versions[0]}/${crd.plural}`)}
                                                                    />
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </>
                                    )}
                                </SidebarGroup>
                            )}
                        </>
                    )}

                    {mode === 'settings' && (
                        <div className="px-3">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-2">Settings</h3>
                            <div className="space-y-0.5">
                                {(!searchQuery || filterMatches('AI Models')) && (
                                    <NavItem
                                        icon={<Box size={18} />}
                                        label="AI Models"
                                        active={true}
                                        onClick={() => { }}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>


            </div>

            {/* Context Menu - Rendered via portal to prevent clipping */}
            {
                contextMenu && ReactDOM.createPortal(
                    <div
                        className="fixed z-[9999] bg-[#1e1e1e] border border-white/10 rounded-md shadow-xl py-1 min-w-[140px]"
                        style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
                    >
                        <button
                            className="w-full text-left px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                            onClick={() => {
                                if (onTogglePin && contextMenu) {
                                    onTogglePin(contextMenu.cluster);
                                }
                                setContextMenu(null);
                            }}
                        >
                            <Pin size={14} className={pinnedClusters.includes(contextMenu.cluster) ? "fill-current" : ""} />
                            {pinnedClusters.includes(contextMenu.cluster) ? "Unpin Cluster" : "Pin Cluster"}
                        </button>
                    </div>,
                    document.body
                )
            }
        </>
    );
};

