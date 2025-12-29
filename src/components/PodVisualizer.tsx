import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutGrid, Server } from 'lucide-react';
import { TimeAgo } from './TimeAgo';

interface PodVisualizerProps {
    pods: any[];
    nodes?: any[];
}

// Custom hook to measure element size
const useResizeObserver = (ref: React.RefObject<HTMLElement>) => {
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    
    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const observer = new ResizeObserver((entries) => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                setDimensions({ width, height });
            }
        });
        
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    
    return dimensions;
};

// Hexagon Component
const Hexagon: React.FC<{ 
    status: string; 
    name: string; 
    onClick?: () => void;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: () => void;
    style?: React.CSSProperties;
}> = ({ status, name, onClick, onMouseEnter, onMouseLeave, style }) => {
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
};

// Tooltip Component
const PodTooltip: React.FC<{ pod: any; position: { x: number; y: number } }> = ({ pod, position }) => (
    <div 
        className="fixed z-50 pointer-events-none bg-gray-900 border border-white/10 rounded-lg shadow-xl px-3 py-2 text-sm text-gray-200 transform -translate-x-1/2 -translate-y-[120%]"
        style={{ left: position.x, top: position.y }}
    >
        <div className="font-semibold mb-1">{pod.metadata.name}</div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className={pod.status === 'Running' ? 'text-green-400' : 'text-yellow-400'}>
                {pod.status}
            </span>
            <span>•</span>
            <TimeAgo timestamp={pod.age} />
        </div>
    </div>
);

export const PodVisualizer: React.FC<PodVisualizerProps> = ({ pods, nodes = [] }) => {
    const [grouping, setGrouping] = useState<'none' | 'node'>('none');
    const containerRef = useRef<HTMLDivElement>(null);
    const { width: containerWidth } = useResizeObserver(containerRef);
    const [hoveredPod, setHoveredPod] = useState<{ pod: any; x: number; y: number } | null>(null);

    // Grouping Logic
    const groupedPods = useMemo(() => {
        if (grouping === 'none') {
            return { 'All Pods': pods };
        }
        
        const groups: Record<string, any[]> = {};
        nodes.forEach(node => { groups[node.name] = []; });
        groups['Unassigned'] = [];

        pods.forEach(pod => {
            const nodeName = pod.spec?.nodeName || 'Unassigned';
            if (!groups[nodeName]) groups[nodeName] = [];
            groups[nodeName].push(pod);
        });

        if (groups['Unassigned'].length === 0) delete groups['Unassigned'];
        return groups;
    }, [pods, nodes, grouping]);

    // Layout config
    const HEX_WIDTH = 56; // 3.5rem equivalent roughly (w-14)
    const HEX_HEIGHT = 64; // h-16
    const GAP = 4; // space between
    
    // Calculate layout for a list of items
    const calculateHeights = (groups: Record<string, any[]>) => {
        if (containerWidth === 0) return {};
        
        // Effective width for calculation
        // Padding is px-4 (16px left + 16px right) = 32px
        const contentWidth = containerWidth - 32; 
        
        // Calculate columns
        // Each column takes HEX_WIDTH + GAP?
        // Honeycomb spacing: 
        // Horizontal distance between centers is HEX_WIDTH + GAP?
        // Actually, for honeycomb, horizontal spacing is full width usually.
        // Let's settle on: x = col * (Width + Gap).
        // If we want tight packing, we can overlap slightly but GAP is safer.
        const colWidth = HEX_WIDTH + GAP;
        const cols = Math.max(1, Math.floor(contentWidth / colWidth));
        
        const groupHeights: Record<string, number> = {};
        
        Object.entries(groups).forEach(([groupName, groupPods]) => {
            const count = groupPods.length;
            if (count === 0) {
                groupHeights[groupName] = 40; // minimal height for header/empty msg
                return;
            }
            
            
            // Calculate height needed
            // Height = rows * (Height * 0.75 usually for honeycomb overlap)
            // Vertical spacing: (HEX_HEIGHT * 0.75 + GAP)
            // We need to actually run the loop to find max Y
            
            let maxY = 0;
            for(let i=0; i<count; i++) {
                const row = Math.floor(i / cols);
                const y = row * (HEX_HEIGHT * 0.80); // 0.8 factor for slight overlap/honeycomb vertical
                if (y + HEX_HEIGHT > maxY) maxY = y + HEX_HEIGHT;
            }
            
            // Add header height (approx 40px) + padding
            groupHeights[groupName] = maxY + 60; 
        });
        
        return { groupHeights, cols };
    };

    const layout = useMemo(() => calculateHeights(groupedPods), [groupedPods, containerWidth]);

    const renderGroup = (groupPods: any[], cols: number) => {
        if (!cols) return null;
        const colWidth = HEX_WIDTH + GAP;
        
        return groupPods.map((pod, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            
            // Honeycomb Offset: Every second row (odd row index) is indented by half width
            const xOffset = (row % 2 === 1) ? (colWidth / 2) : 0;
            
            const left = col * colWidth + xOffset;
            const top = row * (HEX_HEIGHT * 0.80); // 80% of height for spacing
            
            return (
                <Hexagon 
                    key={pod.metadata.uid || pod.metadata.name} 
                    name={pod.metadata.name}
                    status={pod.status}
                    style={{ left, top }}
                    onMouseEnter={(e) => {
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        setHoveredPod({ 
                            pod, 
                            x: rect.left + rect.width / 2, 
                            y: rect.top 
                        });
                    }}
                    onMouseLeave={() => setHoveredPod(null)}
                    onClick={() => {
                        // Handle click
                    }}
                />
            );
        });
    };

    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col h-full bg-transparent overflow-hidden relative"
        >
            {/* Toolbar */}
            <div className="flex items-center justify-end p-4 pb-0 mb-4 z-20">
                <div className="flex bg-black/40 p-1 rounded-lg border border-white/10 backdrop-blur-md">
                    <button
                        onClick={() => setGrouping('none')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all ${
                            grouping === 'none' ? 'bg-white/10 text-white shadow-lg border border-white/10' : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        <LayoutGrid size={12} /> None
                    </button>
                    <button
                        onClick={() => setGrouping('node')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all ${
                            grouping === 'node' ? 'bg-white/10 text-white shadow-lg border border-white/10' : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        <Server size={12} /> Group by Node
                    </button>
                </div>
            </div>

            {/* Grid Content */}
            <div 
                className="flex-1 overflow-y-auto px-4 pb-8 custom-scrollbar relative" 
                ref={containerRef}
            >
                {Object.entries(groupedPods).map(([groupName, groupPods]) => {
                    const height = layout.groupHeights?.[groupName] || 100;
                    
                    return (
                        <div key={groupName} className="mb-8 relative" style={{ height }}>
                            {(grouping !== 'none' || groupName === 'All Pods') && (
                                 <h3 className="text-sm font-semibold text-gray-400 mb-6 flex items-center gap-2 border-b border-white/5 pb-2 ml-1">
                                    {grouping === 'none' ? <LayoutGrid size={14} className="text-blue-400"/> : <Server size={14} className="text-purple-400"/>} 
                                    {groupName} 
                                    <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full text-gray-500 font-normal border border-white/5">
                                        {groupPods.length}
                                    </span>
                                 </h3>
                            )}
                            
                            {groupPods.length === 0 ? (
                                <div className="text-gray-700 italic text-xs p-4 text-center border border-dashed border-white/5 rounded-lg">
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
            <AnimatePresence>
                {hoveredPod && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="fixed z-50 pointer-events-none"
                        style={{ left: 0, top: 0 }} // Position handled in component
                    >
                        <PodTooltip pod={hoveredPod.pod} position={{ x: hoveredPod.x, y: hoveredPod.y }} />
                    </motion.div>
                )}
            </AnimatePresence>
            
            <style>{`
                .clip-hex {
                    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
                }
            `}</style>
        </motion.div>
    );
};
