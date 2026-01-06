import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutGrid, Server, RefreshCw } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';
import { ToggleGroup } from '../../shared/ToggleGroup';

interface PodVisualizerProps {
    pods: any[];
    nodes?: any[];
}

// Custom hook to measure element size
const useResizeObserver = (ref: React.RefObject<HTMLElement>) => {
    // Initialize with window width as fallback to prevent 0-width layout failure
    const [dimensions, setDimensions] = useState({ width: window.innerWidth > 0 ? window.innerWidth : 1000, height: 0 });

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const observer = new ResizeObserver((entries) => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                // Only update if width > 0 to avoid collapsing grid
                if (width > 0) {
                    setDimensions({ width, height });
                }
            }
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);

    return dimensions;
};

// Hexagon Component - Memoized
const Hexagon: React.FC<{
    status: string;
    name: string;
    onClick?: () => void;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: () => void;
    style?: React.CSSProperties;
}> = React.memo(({ status, name, onClick, onMouseEnter, onMouseLeave, style }) => {
    let bgClass = 'bg-white/5 border-white/10';
    let glowClass = '';

    if (status === 'Running' || status === 'Succeeded') {
        bgClass = 'bg-[#10B981]'; // Solid Green
        glowClass = 'group-hover:shadow-[0_0_15px_rgba(16,185,129,0.6)]';
    } else if (status === 'Pending' || status === 'ContainerCreating') {
        bgClass = 'bg-[#EAB308]'; // Solid Yellow
        glowClass = 'group-hover:shadow-[0_0_15px_rgba(234,179,8,0.6)]';
    } else if (status === 'Failed' || status === 'CrashLoopBackOff' || status === 'ErrImagePull') {
        bgClass = 'bg-[#EF4444]'; // Solid Red
        glowClass = 'group-hover:shadow-[0_0_15px_rgba(239,68,68,0.6)]';
    } else {
        bgClass = 'bg-gray-700';
    }

    return (
        <div
            className="absolute group w-14 h-16 cursor-pointer transition-transform hover:scale-110 z-0 hover:z-10"
            style={style}
            title={name}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div
                className={`w-full h-full ${bgClass} ${glowClass} transition-all duration-300 clip-hex border-2 border-transparent`}
                style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}
            />
        </div>
    );
}, (prev, next) => {
    // Custom comparison to really avoid re-renders if core props match
    return prev.status === next.status && prev.name === next.name && prev.style?.left === next.style?.left && prev.style?.top === next.style?.top;
});
Hexagon.displayName = 'Hexagon';

// Tooltip Component
const PodTooltip: React.FC<{ pod: any; position: { x: number; y: number } }> = React.memo(({ pod, position }) => (
    <div
        className="fixed z-50 pointer-events-none bg-gray-900 border border-white/10 rounded-lg shadow-xl px-3 py-2 text-sm text-gray-200 transform -translate-x-1/2 -translate-y-[120%]"
        style={{ left: position.x, top: position.y }}
    >
        <div className="font-semibold mb-1">{pod.metadata?.name || pod.name}</div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className={pod.status === 'Running' ? 'text-green-400' : 'text-yellow-400'}>
                {pod.status}
            </span>
            <span>•</span>
            <TimeAgo timestamp={pod.age || pod.metadata?.creationTimestamp} />
        </div>
    </div>
));
PodTooltip.displayName = 'PodTooltip';

export const PodVisualizer: React.FC<PodVisualizerProps> = ({ pods: livePods, nodes = [] }) => {
    const [snapshotPods, setSnapshotPods] = useState<any[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [grouping, setGrouping] = useState<'none' | 'node'>('none');
    const containerRef = useRef<HTMLDivElement>(null);
    const { width: containerWidth } = useResizeObserver(containerRef);
    const [hoveredPod, setHoveredPod] = useState<{ pod: any; x: number; y: number } | null>(null);

    // Initial load - snapshot live data if we don't have it yet
    useEffect(() => {
        if (snapshotPods.length === 0 && livePods.length > 0) {
            setSnapshotPods(livePods);
        }
    }, [livePods, snapshotPods.length]);

    // Refresh Handler
    const handleRefresh = useCallback(() => {
        console.log(`[PodVisualizer] Manual refresh triggered. Updating snapshot with ${livePods.length} pods.`);
        setIsRefreshing(true);
        setSnapshotPods(livePods);
        setTimeout(() => setIsRefreshing(false), 500);
    }, [livePods]);

    // Grouping Logic
    const groupedPods = useMemo(() => {
        const currentPods = snapshotPods;

        if (grouping === 'none') {
            return { 'All Pods': currentPods };
        }

        const groups: Record<string, any[]> = {};
        nodes.forEach(node => { groups[node.name] = []; });
        groups['Unassigned'] = [];

        currentPods.forEach(pod => {
            if (!pod) return;
            // Handle both k8s structure and flattened structure from dashboard
            const nodeName = pod.spec?.nodeName || pod.node || pod.nodeName || 'Unassigned';

            if (!groups[nodeName]) groups[nodeName] = [];
            groups[nodeName].push(pod);
        });

        if (groups['Unassigned'].length === 0) delete groups['Unassigned'];
        return groups;
    }, [snapshotPods, nodes, grouping]);

    // Layout config
    const HEX_WIDTH = 56;
    const HEX_HEIGHT = 64;
    const GAP = 4;
    const HEADER_HEIGHT = 40;

    // Memoized layout calculation
    const layout = useMemo(() => {
        if (containerWidth === 0) return { groupHeights: {}, cols: 0 };

        const contentWidth = Math.max(containerWidth - 32, 300);
        const colWidth = HEX_WIDTH + GAP;
        const cols = Math.max(1, Math.floor(contentWidth / colWidth));

        const groupHeights: Record<string, number> = {};

        Object.entries(groupedPods).forEach(([groupName, groupPods]) => {
            const count = groupPods.length;
            if (count === 0) {
                groupHeights[groupName] = HEADER_HEIGHT + 20;
                return;
            }

            const lastRow = Math.max(0, Math.floor((count - 1) / cols));
            const y = lastRow * (HEX_HEIGHT * 0.80);
            const maxY = y + HEX_HEIGHT;

            groupHeights[groupName] = maxY + HEADER_HEIGHT + 20;
        });

        return { groupHeights, cols };
    }, [groupedPods, containerWidth]);

    const renderGroup = useCallback((groupPods: any[], cols: number) => {
        if (!cols) return null;
        const colWidth = HEX_WIDTH + GAP;

        return groupPods.map((pod, i) => {
            if (!pod) return null;
            // Handle flattened structure
            const podName = pod.metadata?.name || pod.name;
            const podUid = pod.metadata?.uid || podName;

            if (!podName) return null;

            const row = Math.floor(i / cols);
            const col = i % cols;

            const xOffset = (row % 2 === 1) ? (colWidth / 2) : 0;

            const left = col * colWidth + xOffset;
            const top = row * (HEX_HEIGHT * 0.80) + HEADER_HEIGHT;

            return (
                <Hexagon
                    key={podUid}
                    name={podName}
                    status={pod.status}
                    style={{ left, top }}
                    onMouseEnter={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setHoveredPod({
                            pod,
                            x: rect.left + rect.width / 2,
                            y: rect.top
                        });
                    }}
                    onMouseLeave={() => setHoveredPod(null)}
                />
            );
        });
    }, [HEX_WIDTH, GAP, HEX_HEIGHT, HEADER_HEIGHT]);

    return (
        <div
            className="flex flex-col h-auto bg-transparent relative"
        >
            {/* Toolbar */}
            <div className="flex items-center justify-end p-4 pb-0 mb-4 z-20 sticky top-0">
                <ToggleGroup
                    prefix={
                        <>
                            <button
                                onClick={handleRefresh}
                                disabled={isRefreshing}
                                className={`p-1.5 rounded-md text-gray-400 hover:text-white transition-all ${isRefreshing ? 'animate-spin text-blue-400' : ''}`}
                                title="Refresh Snapshot"
                            >
                                <RefreshCw size={14} />
                            </button>
                            <div className="w-[1px] bg-white/10 mx-1" />
                        </>
                    }
                    options={[
                        { value: 'none', label: 'None', icon: LayoutGrid },
                        { value: 'node', label: 'Group by Node', icon: Server }
                    ]}
                    value={grouping}
                    onChange={(val) => setGrouping(val as 'none' | 'node')}
                />
            </div>

            {/* Grid Content - Auto Height */}
            <div
                className="w-full px-4 pb-8 relative"
                ref={containerRef}
            >
                {Object.entries(groupedPods).map(([groupName, groupPods]) => {
                    const height = layout.groupHeights?.[groupName] || 100;

                    return (
                        <div key={groupName} className="mb-8 relative" style={{ height }}>
                            {(grouping !== 'none' || groupName === 'All Pods') && (
                                <h3 className="text-sm font-semibold text-gray-400 mb-6 flex items-center gap-2 border-b border-white/5 pb-2 ml-1 absolute top-0 left-0 right-0 h-10">
                                    {grouping === 'none' ? <LayoutGrid size={14} className="text-blue-400" /> : <Server size={14} className="text-purple-400" />}
                                    {groupName}
                                    <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full text-gray-500 font-normal border border-white/5">
                                        {groupPods.length}
                                    </span>
                                </h3>
                            )}

                            {groupPods.length === 0 ? (
                                <div className="text-gray-700 italic text-xs p-4 text-center border border-dashed border-white/5 rounded-lg absolute top-12 w-full">
                                    No pods
                                </div>
                            ) : (
                                <div className="relative w-full">
                                    {renderGroup(groupPods, layout.cols || 1)}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Tooltip Portal/Overlay */}
            {createPortal(
                <AnimatePresence>
                    {hoveredPod && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="fixed z-50 pointer-events-none"
                            style={{ left: 0, top: 0 }}
                        >
                            <PodTooltip pod={hoveredPod.pod} position={{ x: hoveredPod.x, y: hoveredPod.y }} />
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}

            <style>{`
                .clip-hex {
                    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
                }
            `}</style>
        </div>
    );
};
