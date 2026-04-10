import React, { useRef, useEffect } from 'react';
import { X, LayoutGrid, Box, Layers, Server, Ghost, Database, Copy, Play, Clock, Network, Share2, Globe, ShieldCheck, HardDrive, File, Key, TrendingUp, Shield, Webhook, Star, Cpu, Anchor, Users, Puzzle } from 'lucide-react';

export interface ViewTab {
    id: string;   // matches the view name (e.g. 'pods', 'deployments')
    label: string;
}

interface ViewTabBarProps {
    tabs: ViewTab[];
    activeTabId: string;
    onSelectTab: (id: string) => void;
    onCloseTab: (id: string) => void;
}

const VIEW_ICON_MAP: Record<string, React.ReactNode> = {
    'overview': <LayoutGrid size={13} />,
    'pods': <Box size={13} />,
    'deployments': <Layers size={13} />,
    'nodes': <Server size={13} />,
    'namespaces': <Layers size={13} />,
    'daemonsets': <Ghost size={13} />,
    'statefulsets': <Database size={13} />,
    'replicasets': <Copy size={13} />,
    'jobs': <Play size={13} />,
    'cronjobs': <Clock size={13} />,
    'services': <Network size={13} />,
    'endpointslices': <Share2 size={13} />,
    'endpoints': <Share2 size={13} />,
    'ingresses': <Globe size={13} />,
    'ingressclasses': <Globe size={13} />,
    'networkpolicies': <ShieldCheck size={13} />,
    'persistentvolumeclaims': <HardDrive size={13} />,
    'persistentvolumes': <HardDrive size={13} />,
    'storageclasses': <Database size={13} />,
    'configmaps': <File size={13} />,
    'secrets': <Key size={13} />,
    'horizontalpodautoscalers': <TrendingUp size={13} />,
    'poddisruptionbudgets': <Shield size={13} />,
    'mutatingwebhookconfigurations': <Webhook size={13} />,
    'validatingwebhookconfigurations': <ShieldCheck size={13} />,
    'priorityclasses': <Star size={13} />,
    'runtimeclasses': <Cpu size={13} />,
    'helm-releases': <Anchor size={13} />,
    'clusterroles': <Shield size={13} />,
    'clusterrolebindings': <Shield size={13} />,
    'roles': <Users size={13} />,
    'rolebindings': <Users size={13} />,
    'serviceaccounts': <Users size={13} />,
    'certificates': <Shield size={13} />,
    'aws': <Shield size={13} />,
    'crd-definitions': <Puzzle size={13} />,
};

function getViewIcon(viewId: string): React.ReactNode {
    if (viewId.startsWith('crd/')) return <Puzzle size={13} />;
    return VIEW_ICON_MAP[viewId] ?? <Box size={13} />;
}

export const ViewTabBar: React.FC<ViewTabBarProps> = ({ tabs, activeTabId, onSelectTab, onCloseTab }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const activeRef = useRef<HTMLDivElement>(null);

    // Scroll active tab into view when it changes
    useEffect(() => {
        activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }, [activeTabId]);

    if (tabs.length <= 1) return null;

    return (
        <div className="flex-none flex items-center border-b border-white/5 bg-white/[0.02] rounded-xl">
            <div
                ref={scrollRef}
                className="flex-1 flex items-center overflow-x-auto scrollbar-none"
                style={{ scrollbarWidth: 'none' }}
            >
                {tabs.map(tab => {
                    const isActive = tab.id === activeTabId;
                    return (
                        <div
                            key={tab.id}
                            ref={isActive ? activeRef : undefined}
                            onClick={() => onSelectTab(tab.id)}
                            className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors border-b-2 flex-shrink-0 ${
                                isActive
                                    ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/5'
                            }`}
                        >
                            <span className="opacity-60">{getViewIcon(tab.id)}</span>
                            <span className="text-xs whitespace-nowrap">{tab.label}</span>
                            {tab.id !== 'overview' && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCloseTab(tab.id);
                                    }}
                                    className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
                                    aria-label={`Close ${tab.label} tab`}
                                >
                                    <X size={11} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
