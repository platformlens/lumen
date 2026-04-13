import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Server, Zap, AlertCircle, CheckCircle, BarChart2, Shield, Cpu, MemoryStick } from 'lucide-react';
import { TableVirtuoso } from 'react-virtuoso';
import { getNodeProviderInfo } from '../../../utils/cluster-utils';
import { TimeAgo } from '../../shared/TimeAgo';
import { StatusBadge } from '../../shared/StatusBadge';
import { Tooltip as LumenTooltip } from '../../shared/Tooltip';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell
} from 'recharts';

const tableStyles = `
  .nodes-table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .nodes-table-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  .nodes-table-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;
  }
  .nodes-table-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .nodes-table-container th {
    padding: 0.75rem 1.5rem;
    outline: none;
    position: relative;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: #6b7280;
    text-transform: uppercase;
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-align: left;
    white-space: nowrap;
  }
  .nodes-table-container th:first-child {
    border-top-left-radius: 0;
  }
  .nodes-table-container th:last-child {
    border-top-right-radius: 0;
  }
  .nodes-table-container th.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .nodes-table-container td {
    padding: 0.75rem 1.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    outline: none;
    font-size: var(--lumen-table-font-size, 14px);
  }
  .nodes-table-container td.no-truncate {
    overflow: visible;
    text-overflow: clip;
  }
  .nodes-table-container td.compact-column {
    padding: 0.5rem 0.5rem;
    text-align: center;
  }
  .column-resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 8px;
    cursor: col-resize;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .column-resize-handle:hover::after,
  .column-resize-handle.resizing::after {
    content: '';
    width: 2px;
    height: 100%;
    background-color: rgba(59, 130, 246, 0.5);
  }
  .column-resize-handle.resizing::after {
    background-color: rgba(59, 130, 246, 0.8);
  }
`;

interface NodeColumnDef {
    key: string;
    label: string;
    defaultWidth: number;
    sortable?: boolean;
    compact?: boolean;
    flexGrow?: number;
}

const NODE_COLUMNS: NodeColumnDef[] = [
    { key: 'name', label: 'Name', defaultWidth: 200, sortable: true, flexGrow: 2 },
    { key: 'status', label: 'Status', defaultWidth: 90, sortable: true },
    { key: 'cpuUtil', label: 'CPU Requests', defaultWidth: 150, sortable: true, flexGrow: 1 },
    { key: 'memUtil', label: 'Memory Requests', defaultWidth: 150, sortable: true, flexGrow: 1 },
    { key: 'instanceType', label: 'Instance Type', defaultWidth: 120, sortable: true },
    { key: 'zone', label: 'Zone', defaultWidth: 120, sortable: true },
    { key: 'capacityType', label: 'Capacity', defaultWidth: 100, sortable: true },
    { key: 'taints', label: 'Taints', defaultWidth: 80, sortable: true },
    { key: 'age', label: 'Age', defaultWidth: 90, sortable: true },
];

const TABLE_ID = 'nodes-virtuoso';

// Stable TableVirtuoso sub-component (defined outside render to avoid remounts)
const VirtuosoTableHead = React.forwardRef<HTMLTableSectionElement>((props, ref) => (
    <thead {...props} ref={ref} style={{ ...(props as any).style, position: 'sticky', top: 0, zIndex: 2 }} />
));

function loadColumnWidths(): Record<string, number> {
    const defaults: Record<string, number> = {};
    NODE_COLUMNS.forEach(c => { defaults[c.key] = c.defaultWidth; });
    try {
        const saved = localStorage.getItem(`table-column-widths-${TABLE_ID}`);
        if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return defaults;
}

function saveColumnWidths(widths: Record<string, number>) {
    try {
        localStorage.setItem(`table-column-widths-${TABLE_ID}`, JSON.stringify(widths));
    } catch { /* ignore */ }
}

interface NodesViewProps {
    nodes: any[];
    pods: any[];
    onRowClick?: (node: any) => void;
    searchQuery?: string;
}

// Utilization Bar Component
const UtilizationBar: React.FC<{ percentage: number; type: 'cpu' | 'memory' }> = ({ percentage, type }) => {
    const isUnderutilized = percentage < 30;
    const isHigh = percentage > 80;

    let barColor = 'bg-blue-500';
    let bgColor = 'bg-blue-500/20';

    if (type === 'memory') {
        barColor = 'bg-purple-500';
        bgColor = 'bg-purple-500/20';
    }

    if (isUnderutilized) {
        barColor = 'bg-yellow-500';
        bgColor = 'bg-yellow-500/20';
    } else if (isHigh) {
        barColor = 'bg-red-500';
        bgColor = 'bg-red-500/20';
    }

    return (
        <div className="flex items-center gap-2 w-full">
            <div className={`flex-1 h-2 ${bgColor} rounded-full overflow-hidden`}>
                <div
                    className={`h-full ${barColor} transition-all duration-300`}
                    style={{ width: `${Math.min(percentage, 100)}%` }}
                />
            </div>
            <span className={`text-[10px] font-mono w-10 text-right ${isUnderutilized ? 'text-yellow-400' : isHigh ? 'text-red-400' : 'text-gray-400'}`}>
                {percentage.toFixed(0)}%
            </span>
        </div>
    );
};

const NodesViewInner: React.FC<NodesViewProps> = ({ nodes, pods, onRowClick, searchQuery = '' }) => {
    const [showStats, setShowStats] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadColumnWidths);
    const [resizing, setResizing] = useState<{ key: string; startX: number; startW: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    // Track container width via ResizeObserver
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        setContainerWidth(el.clientWidth);
        return () => observer.disconnect();
    }, []);

    // Column resize logic
    useEffect(() => {
        if (!resizing) return;
        const onMove = (e: MouseEvent) => {
            const delta = e.clientX - resizing.startX;
            const newW = Math.max(50, resizing.startW + delta);
            setColumnWidths(prev => ({ ...prev, [resizing.key]: newW }));
        };
        const onUp = () => {
            setColumnWidths(prev => { saveColumnWidths(prev); return prev; });
            setResizing(null);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [resizing]);

    // Distribute extra space via flexGrow
    const effectiveWidths = useMemo(() => {
        const baseTotal = Object.values(columnWidths).reduce((a, b) => a + b, 0);
        if (containerWidth <= baseTotal || containerWidth === 0) {
            return columnWidths;
        }
        const extraSpace = containerWidth - baseTotal;
        const totalGrow = NODE_COLUMNS.reduce((sum, col) => sum + (col.flexGrow ?? 0), 0);
        if (totalGrow === 0) return columnWidths;

        const result: Record<string, number> = {};
        for (const col of NODE_COLUMNS) {
            const base = columnWidths[col.key] ?? col.defaultWidth;
            const grow = col.flexGrow ?? 0;
            result[col.key] = base + (grow > 0 ? Math.floor(extraSpace * grow / totalGrow) : 0);
        }
        return result;
    }, [columnWidths, containerWidth]);

    const effectiveTotalWidth = useMemo(() => Object.values(effectiveWidths).reduce((a, b) => a + b, 0), [effectiveWidths]);

    // Calculate resource requests per node
    const nodeUtilization = useMemo(() => {
        const utilMap = new Map<string, { cpuRequested: number; memoryRequested: number; cpuCapacity: number; memoryCapacity: number }>();

        const cpuCache = new Map<string, number>();
        const memCache = new Map<string, number>();

        const parseCpu = (cpu: string): number => {
            if (!cpu) return 0;
            if (cpuCache.has(cpu)) return cpuCache.get(cpu)!;
            let result: number;
            if (cpu.endsWith('m')) {
                result = parseInt(cpu);
            } else {
                result = parseFloat(cpu) * 1000;
            }
            cpuCache.set(cpu, result);
            return result;
        };

        const parseMemory = (mem: string): number => {
            if (!mem) return 0;
            if (memCache.has(mem)) return memCache.get(mem)!;
            const units: Record<string, number> = {
                'Ki': 1024,
                'Mi': 1024 * 1024,
                'Gi': 1024 * 1024 * 1024,
                'K': 1000,
                'M': 1000 * 1000,
                'G': 1000 * 1000 * 1000
            };
            let result = 0;
            for (const [suffix, multiplier] of Object.entries(units)) {
                if (mem.endsWith(suffix)) {
                    result = parseFloat(mem.slice(0, -suffix.length)) * multiplier;
                    break;
                }
            }
            if (result === 0) result = parseFloat(mem);
            memCache.set(mem, result);
            return result;
        };

        nodes.forEach(node => {
            const nodeName = node.metadata?.name || node.name;
            utilMap.set(nodeName, {
                cpuRequested: 0,
                memoryRequested: 0,
                cpuCapacity: parseCpu(node.cpu || '0'),
                memoryCapacity: parseMemory(node.memory || '0')
            });
        });

        pods.forEach(pod => {
            const nodeName = pod.spec?.nodeName || pod.nodeName;
            if (!nodeName) return;
            const util = utilMap.get(nodeName);
            if (!util) return;
            const containers = pod.spec?.containers || [];
            containers.forEach((container: any) => {
                const requests = container.resources?.requests;
                if (!requests) return;
                util.cpuRequested += parseCpu(requests.cpu || '0');
                util.memoryRequested += parseMemory(requests.memory || '0');
            });
        });

        return utilMap;
    }, [nodes, pods]);

    // Filter logic
    const filteredNodes = useMemo(() => {
        if (!searchQuery) return nodes;
        const lowerQuery = searchQuery.toLowerCase();
        return nodes.filter(node => {
            const name = node.metadata?.name?.toLowerCase() || node.name?.toLowerCase() || '';
            const info = getNodeProviderInfo(node);
            const instanceType = info.instanceType?.toLowerCase() || '';
            const zone = info.zone?.toLowerCase() || '';
            return name.includes(lowerQuery) || instanceType.includes(lowerQuery) || zone.includes(lowerQuery);
        });
    }, [nodes, searchQuery]);

    // Sort logic
    const sortedNodes = useMemo(() => {
        if (!sortConfig) return filteredNodes;
        const sorted = [...filteredNodes].sort((a, b) => {
            let aValue: any;
            let bValue: any;
            switch (sortConfig.key) {
                case 'name':
                    aValue = a.name || '';
                    bValue = b.name || '';
                    break;
                case 'status':
                    aValue = a.status || '';
                    bValue = b.status || '';
                    break;
                case 'age':
                    aValue = new Date(a.age).getTime();
                    bValue = new Date(b.age).getTime();
                    break;
                case 'instanceType':
                    aValue = getNodeProviderInfo(a).instanceType || '';
                    bValue = getNodeProviderInfo(b).instanceType || '';
                    break;
                case 'zone':
                    aValue = getNodeProviderInfo(a).zone || '';
                    bValue = getNodeProviderInfo(b).zone || '';
                    break;
                case 'capacityType':
                    aValue = getNodeProviderInfo(a).isSpot ? 1 : 0;
                    bValue = getNodeProviderInfo(b).isSpot ? 1 : 0;
                    break;
                case 'taints':
                    aValue = (a.spec?.taints || []).length;
                    bValue = (b.spec?.taints || []).length;
                    break;
                case 'cpuUtil': {
                    const aUtil = nodeUtilization.get(a.metadata?.name || a.name);
                    const bUtil = nodeUtilization.get(b.metadata?.name || b.name);
                    aValue = aUtil && aUtil.cpuCapacity ? (aUtil.cpuRequested / aUtil.cpuCapacity) : 0;
                    bValue = bUtil && bUtil.cpuCapacity ? (bUtil.cpuRequested / bUtil.cpuCapacity) : 0;
                    break;
                }
                case 'memUtil': {
                    const aUtil = nodeUtilization.get(a.metadata?.name || a.name);
                    const bUtil = nodeUtilization.get(b.metadata?.name || b.name);
                    aValue = aUtil && aUtil.memoryCapacity ? (aUtil.memoryRequested / aUtil.memoryCapacity) : 0;
                    bValue = bUtil && bUtil.memoryCapacity ? (bUtil.memoryRequested / bUtil.memoryCapacity) : 0;
                    break;
                }
                default:
                    return 0;
            }
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [filteredNodes, sortConfig, nodeUtilization]);

    const handleSort = useCallback((key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) {
                return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
    }, []);

    // Refs for stable TableVirtuoso component callbacks
    const effectiveTotalWidthRef = useRef(effectiveTotalWidth);
    effectiveTotalWidthRef.current = effectiveTotalWidth;
    const sortedNodesRef = useRef(sortedNodes);
    sortedNodesRef.current = sortedNodes;
    const onRowClickRef = useRef(onRowClick);
    onRowClickRef.current = onRowClick;

    const virtuosoComponents = useMemo(() => ({
        Table: ({ style, ...props }: any) => (
            <table {...props} style={{ ...style, width: '100%', minWidth: effectiveTotalWidthRef.current, tableLayout: 'fixed' as const, borderCollapse: 'separate' as const, borderSpacing: 0 }} />
        ),
        TableHead: VirtuosoTableHead,
        TableRow: ({ style, item, ...props }: any) => {
            const index = props['data-index'] as number;
            const node = sortedNodesRef.current[index];
            return (
                <tr
                    {...props}
                    style={{ ...style, height: 52, cursor: 'pointer' }}
                    className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.03]"
                    onClick={() => node && onRowClickRef.current?.(node)}
                />
            );
        },
    }), []); // Stable — never recreated

    // Cell renderer
    const renderCell = useCallback((col: NodeColumnDef, node: any) => {
        switch (col.key) {
            case 'name': {
                const isReady = node.status === 'Ready';
                const taints: any[] = node.spec?.taints || [];
                const isCordoned = taints.some((t: any) => t.key === 'node.kubernetes.io/unschedulable');
                const dotColor = !isReady ? 'bg-red-400' : isCordoned ? 'bg-yellow-400' : 'bg-green-400';
                return (
                    <span className="flex items-center gap-2 font-medium text-gray-200">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                        {node.name || node.metadata?.name}
                    </span>
                );
            }
            case 'status':
                return <StatusBadge condition={node.status === 'Ready'} />;
            case 'cpuUtil': {
                const nodeName = node.metadata?.name || node.name;
                const util = nodeUtilization.get(nodeName);
                if (!util || util.cpuCapacity === 0) return <span className="text-gray-500 text-xs">N/A</span>;
                const percentage = (util.cpuRequested / util.cpuCapacity) * 100;
                return <UtilizationBar percentage={percentage} type="cpu" />;
            }
            case 'memUtil': {
                const nodeName = node.metadata?.name || node.name;
                const util = nodeUtilization.get(nodeName);
                if (!util || util.memoryCapacity === 0) return <span className="text-gray-500 text-xs">N/A</span>;
                const percentage = (util.memoryRequested / util.memoryCapacity) * 100;
                return <UtilizationBar percentage={percentage} type="memory" />;
            }
            case 'instanceType': {
                const info = getNodeProviderInfo(node);
                return <span className="font-mono text-xs text-gray-400">{info.instanceType}</span>;
            }
            case 'zone': {
                const info = getNodeProviderInfo(node);
                return <span className="text-gray-400 text-xs">{info.zone}</span>;
            }
            case 'capacityType': {
                const info = getNodeProviderInfo(node);
                return (
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${info.isSpot
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    }`}>
                        {info.capacityType}
                    </span>
                );
            }
            case 'taints': {
                const taints: any[] = node.spec?.taints || [];
                if (taints.length === 0) {
                    return <span className="text-gray-600 text-xs">None</span>;
                }
                const tooltipContent = (
                    <div className="flex flex-col gap-1 max-w-xs">
                        {taints.map((t: any, i: number) => (
                            <div key={i} className="flex items-center gap-1.5 text-xs">
                                <span className="text-red-300 font-medium">{t.effect}</span>
                                <span className="text-gray-400">{t.key}{t.value ? `=${t.value}` : ''}</span>
                            </div>
                        ))}
                    </div>
                );
                return (
                    <LumenTooltip content={tooltipContent} placement="top">
                        <span className="flex items-center gap-1 cursor-default">
                            <Shield size={12} className="text-red-400" />
                            <span className="text-red-400 text-xs font-medium">{taints.length}</span>
                        </span>
                    </LumenTooltip>
                );
            }
            case 'age':
                return <span className="text-gray-400"><TimeAgo timestamp={node.age} /></span>;
            default:
                return null;
        }
    }, [nodeUtilization]);

    // Header row renderer
    const fixedHeaderContent = useCallback(() => (
        <tr>
            {NODE_COLUMNS.map((col, colIdx) => (
                <th
                    key={col.key}
                    style={{ width: effectiveWidths[col.key], minWidth: columnWidths[col.key] }}
                    className={col.compact ? 'compact-column' : ''}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                    <div className="flex items-center gap-1 cursor-pointer select-none group w-full">
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                            {col.label}
                            {col.sortable && sortConfig?.key === col.key && (
                                <span className="text-xs text-blue-400">
                                    {sortConfig.direction === 'asc' ? '▲' : '▼'}
                                </span>
                            )}
                        </div>
                        {colIdx !== NODE_COLUMNS.length - 1 && (
                            <div
                                className={`column-resize-handle ${resizing?.key === col.key ? 'resizing' : ''}`}
                                onMouseDown={(e) => { e.stopPropagation(); setResizing({ key: col.key, startX: e.clientX, startW: columnWidths[col.key] }); }}
                                onClick={(e) => e.stopPropagation()}
                            />
                        )}
                    </div>
                </th>
            ))}
        </tr>
    ), [effectiveWidths, columnWidths, handleSort, sortConfig, resizing]);

    // Row content renderer
    const rowContent = useCallback((index: number) => {
        const node = sortedNodes[index];
        if (!node) return null;
        return (
            <>
                {NODE_COLUMNS.map(col => (
                    <td
                        key={col.key}
                        style={{ width: effectiveWidths[col.key], minWidth: columnWidths[col.key] }}
                        className={`${col.compact ? 'compact-column' : ''}${col.key === 'taints' ? ' no-truncate' : ''}`}
                    >
                        {renderCell(col, node)}
                    </td>
                ))}
            </>
        );
    }, [sortedNodes, effectiveWidths, columnWidths, renderCell]);

    // Calculate Stats based on sorted (filtered) nodes
    const { stats, chartData } = useMemo(() => {
        let onDemand = 0;
        let spot = 0;
        let ready = 0;
        let notReady = 0;
        let totalCpuMillis = 0;
        let totalMemoryBytes = 0;

        const zoneMap = new Map<string, number>();
        const typeMap = new Map<string, number>();

        sortedNodes.forEach(node => {
            const info = getNodeProviderInfo(node);
            if (info.isSpot) spot++;
            else onDemand++;

            const isReady = node.status === 'Ready';
            if (isReady) ready++;
            else notReady++;

            const nodeName = node.metadata?.name || node.name;
            const util = nodeUtilization.get(nodeName);
            if (util) {
                totalCpuMillis += util.cpuCapacity;
                totalMemoryBytes += util.memoryCapacity;
            }

            const zone = info.zone || 'Unknown';
            zoneMap.set(zone, (zoneMap.get(zone) || 0) + 1);

            const type = info.instanceType || 'Unknown';
            typeMap.set(type, (typeMap.get(type) || 0) + 1);
        });

        const capacityData = [
            { name: 'On-Demand', value: onDemand },
            { name: 'Spot', value: spot }
        ];

        const zoneData = Array.from(zoneMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        const typeData = Array.from(typeMap.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            stats: { onDemand, spot, ready, notReady, totalCpuMillis, totalMemoryBytes },
            chartData: { capacity: capacityData, zones: zoneData, types: typeData }
        };
    }, [sortedNodes, nodeUtilization]);

    const cardStyles = "bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-between hover:bg-white/10 transition-colors";

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col h-full overflow-hidden"
        >
            <div className="flex items-center justify-between mb-4 flex-none">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowStats(!showStats)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${showStats
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                        }`}
                    >
                        <BarChart2 size={14} />
                        {showStats ? 'Hide Stats' : 'Show Stats'}
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6 flex-none">
                <div className={cardStyles}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">On-Demand</span>
                        <Server size={16} className="text-blue-400" />
                    </div>
                    <div className="text-2xl font-bold text-white">{stats.onDemand}</div>
                </div>
                <div className={cardStyles}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Spot</span>
                        <Zap size={16} className="text-purple-400" />
                    </div>
                    <div className="text-2xl font-bold text-white">{stats.spot}</div>
                </div>
                <div className={cardStyles}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ready</span>
                        <CheckCircle size={16} className="text-green-400" />
                    </div>
                    <div className="text-2xl font-bold text-white">{stats.ready}</div>
                </div>
                {stats.notReady > 0 ? (
                    <div className={`${cardStyles} border-red-500/20 bg-red-500/5`}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">Not Ready</span>
                            <AlertCircle size={16} className="text-red-500" />
                        </div>
                        <div className="text-2xl font-bold text-white">{stats.notReady}</div>
                    </div>
                ) : (
                    <div className={cardStyles}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Not Ready</span>
                            <AlertCircle size={16} className="text-gray-600" />
                        </div>
                        <div className="text-2xl font-bold text-gray-500">0</div>
                    </div>
                )}
            </div>

            {/* Expanded Stats View */}
            {showStats && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col gap-4 mb-6 flex-none"
                >
                    {/* Cluster Totals */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-blue-500/10">
                                <Cpu size={20} className="text-blue-400" />
                            </div>
                            <div>
                                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total CPU</span>
                                <div className="text-2xl font-bold text-white">
                                    {(stats.totalCpuMillis / 1000).toFixed(1)} <span className="text-sm font-normal text-gray-400">cores</span>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-purple-500/10">
                                <MemoryStick size={20} className="text-purple-400" />
                            </div>
                            <div>
                                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Memory</span>
                                <div className="text-2xl font-bold text-white">
                                    {(stats.totalMemoryBytes / (1024 * 1024 * 1024)).toFixed(1)} <span className="text-sm font-normal text-gray-400">GiB</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-3 gap-4">
                        {/* Capacity Distribution */}
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col h-64">
                            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Capacity Distribution</h4>
                            <div className="flex-1 w-full min-h-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={chartData.capacity}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={40}
                                            outerRadius={70}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {chartData.capacity.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.name === 'Spot' ? '#a855f7' : '#3b82f6'} stroke="rgba(0,0,0,0.2)" />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }}
                                            itemStyle={{ color: '#E5E7EB' }}
                                        />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Zone Distribution */}
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col h-64">
                            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Zone Distribution</h4>
                            <div className="flex-1 w-full min-h-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData.zones} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                        <XAxis type="number" hide />
                                        <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10, fill: '#9ca3af' }} interval={0} />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                            contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }}
                                            itemStyle={{ color: '#E5E7EB' }}
                                        />
                                        <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Instance Types */}
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col h-64">
                            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Instance Types</h4>
                            <div className="flex-1 w-full min-h-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={chartData.types} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={0} />
                                        <YAxis hide />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                            contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }}
                                            itemStyle={{ color: '#E5E7EB' }}
                                        />
                                        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* Table */}
            <div className="flex-1 min-h-0">
                <div ref={containerRef} className="relative flex-1 h-full w-full min-h-[400px] nodes-table-container rounded-t-lg" style={{ overflowClipMargin: 0, overflow: 'clip' }}>
                    <style>{tableStyles}</style>
                    <TableVirtuoso
                        totalCount={sortedNodes.length}
                        fixedHeaderContent={fixedHeaderContent}
                        itemContent={rowContent}
                        style={{ height: '100%' }}
                        overscan={200}
                        components={virtuosoComponents}
                    />
                </div>
            </div>
        </motion.div>
    );
};

export const NodesView = React.memo(NodesViewInner);
