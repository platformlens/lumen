import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Server, Cpu, HardDrive, Box, Activity, Settings, AlertTriangle,
    CheckCircle, XCircle, Clock, Zap, Shield, RefreshCw, ChevronLeft, ChevronRight
} from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';
import {
    PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
    BarChart, Bar, XAxis, YAxis
} from 'recharts';

interface KarpenterViewProps {
    clusterName: string;
    searchQuery?: string;
}

// --- Helpers ---

function parseCpu(cpu: string | number | undefined): number {
    if (cpu === undefined || cpu === null) return 0;
    if (typeof cpu === 'number') return cpu * 1000;
    const s = String(cpu);
    if (s.endsWith('m')) return parseInt(s, 10);
    return parseFloat(s) * 1000;
}

function parseMemoryGi(mem: string | number | undefined): number {
    if (mem === undefined || mem === null) return 0;
    if (typeof mem === 'number') return mem / (1024 * 1024 * 1024);
    const s = String(mem);
    if (s.endsWith('Gi')) return parseFloat(s);
    if (s.endsWith('Mi')) return parseFloat(s) / 1024;
    if (s.endsWith('Ki')) return parseFloat(s) / (1024 * 1024);
    if (s.endsWith('Ti')) return parseFloat(s) * 1024;
    if (s.endsWith('G')) return parseFloat(s) * 1000 / 1024;
    if (s.endsWith('M')) return parseFloat(s) * 1000 / (1024 * 1024);
    return parseFloat(s) / (1024 * 1024 * 1024);
}

function formatCpu(millis: number): string {
    if (millis >= 1000) return `${(millis / 1000).toFixed(0)} vCPU`;
    return `${millis}m`;
}

function formatMemory(gi: number): string {
    if (gi >= 1024) return `${(gi / 1024).toFixed(1)} TiB`;
    if (gi >= 1) return `${gi.toFixed(0)} GiB`;
    return `${(gi * 1024).toFixed(0)} MiB`;
}

const EVENTS_PER_PAGE = 15;

const EVENT_CATEGORIES: Record<string, { label: string; color: string; reasons: Set<string> }> = {
    disruption: {
        label: 'Disruption',
        color: 'text-red-400',
        reasons: new Set([
            'DisruptionBlocked', 'Unconsolidatable', 'SpotInterrupted',
            'SpotRebalanceRecommendation', 'Disrupting', 'DisruptionTerminating',
        ]),
    },
    provisioning: {
        label: 'Provisioning',
        color: 'text-blue-400',
        reasons: new Set([
            'Provisioning', 'Launched', 'Registered', 'Initialized',
            'NominatePods', 'PodNominated', 'DisruptionLaunching',
        ]),
    },
    deprovisioning: {
        label: 'Deprovisioning',
        color: 'text-yellow-400',
        reasons: new Set([
            'Terminating', 'TerminatingNode', 'Deprovisioning',
            'EmptinessTimedOut', 'Expired', 'Drifted',
        ]),
    },
    health: {
        label: 'Health',
        color: 'text-green-400',
        reasons: new Set([
            'FailedDraining', 'FailedScheduling', 'InsufficientCapacity',
            'NodeNotReady', 'Unhealthy',
        ]),
    },
};

function categorizeEvent(reason: string): string {
    for (const [cat, def] of Object.entries(EVENT_CATEGORIES)) {
        if (def.reasons.has(reason)) return cat;
    }
    return 'other';
}


export const KarpenterView: React.FC<KarpenterViewProps> = ({ clusterName, searchQuery = '' }) => {
    const [nodePools, setNodePools] = useState<any[]>([]);
    const [nodeClaims, setNodeClaims] = useState<any[]>([]);
    const [ec2NodeClasses, setEc2NodeClasses] = useState<any[]>([]);
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [eventFilter, setEventFilter] = useState<string>('all');
    const [eventPage, setEventPage] = useState(1);

    const fetchData = useCallback(async () => {
        try {
            const [np, nc, enc] = await Promise.all([
                window.k8s.listCustomObjects(clusterName, 'karpenter.sh', 'v1', 'nodepools'),
                window.k8s.listCustomObjects(clusterName, 'karpenter.sh', 'v1', 'nodeclaims'),
                window.k8s.listCustomObjects(clusterName, 'karpenter.k8s.aws', 'v1', 'ec2nodeclasses').catch(() => []),
            ]);
            setNodePools(np);
            setNodeClaims(nc);
            setEc2NodeClasses(enc);
        } catch (err) {
            console.error('[KarpenterView] Failed to load data:', err);
        } finally {
            setLoading(false);
        }
    }, [clusterName]);

    // Fetch events separately with polling
    const fetchEvents = useCallback(async () => {
        try {
            // Fetch events for Karpenter-related objects
            const allEvents = await (window.k8s as any).getEvents(clusterName, ['all']);
            const karpenterEvents = allEvents.filter((e: any) => {
                const obj = e.object || '';
                const reason = e.reason || '';
                return obj.includes('NodeClaim') || obj.includes('NodePool') ||
                    EVENT_CATEGORIES.disruption.reasons.has(reason) ||
                    EVENT_CATEGORIES.provisioning.reasons.has(reason) ||
                    EVENT_CATEGORIES.deprovisioning.reasons.has(reason) ||
                    EVENT_CATEGORIES.health.reasons.has(reason);
            });
            setEvents(karpenterEvents);
        } catch {
            // Events are supplementary
        }
    }, [clusterName]);

    useEffect(() => {
        fetchData();
        fetchEvents();
        const interval = setInterval(fetchEvents, 10000);
        return () => clearInterval(interval);
    }, [fetchData, fetchEvents]);

    // --- Computed Stats ---

    const stats = useMemo(() => {
        let totalCpuMillis = 0;
        let totalMemoryGi = 0;
        let usedCpuMillis = 0;
        let usedMemoryGi = 0;
        let readyPools = 0;
        let totalNodes = 0;

        nodePools.forEach(np => {
            const res = np.status?.resources || {};
            const limits = np.spec?.limits || {};
            const conditions = np.status?.conditions || [];
            const isReady = conditions.some((c: any) => c.type === 'Ready' && c.status === 'True');
            if (isReady) readyPools++;

            usedCpuMillis += parseCpu(res.cpu);
            usedMemoryGi += parseMemoryGi(res.memory);
            totalCpuMillis += parseCpu(limits.cpu) || 0;
            totalMemoryGi += parseMemoryGi(limits.memory) || 0;
            totalNodes += parseInt(res.nodes || '0', 10);
        });

        return {
            totalPools: nodePools.length,
            readyPools,
            totalNodeClasses: ec2NodeClasses.length,
            totalNodeClaims: nodeClaims.length,
            totalNodes,
            usedCpuMillis,
            usedMemoryGi,
            totalCpuMillis,
            totalMemoryGi,
        };
    }, [nodePools, nodeClaims, ec2NodeClasses]);

    const nodePoolRows = useMemo(() => {
        return nodePools.map(np => {
            const res = np.status?.resources || {};
            const limits = np.spec?.limits || {};
            const disruption = np.spec?.disruption || {};
            const conditions = np.status?.conditions || [];
            const isReady = conditions.some((c: any) => c.type === 'Ready' && c.status === 'True');
            const weight = np.spec?.weight;

            return {
                name: np.metadata?.name || '',
                ready: isReady,
                nodes: parseInt(res.nodes || '0', 10),
                cpuUsed: parseCpu(res.cpu),
                cpuLimit: parseCpu(limits.cpu),
                memUsed: parseMemoryGi(res.memory),
                memLimit: parseMemoryGi(limits.memory),
                consolidationPolicy: disruption.consolidationPolicy || '-',
                consolidateAfter: disruption.consolidateAfter || '-',
                weight: weight ?? '-',
                nodeClassRef: np.spec?.template?.spec?.nodeClassRef?.name || '-',
                age: np.metadata?.creationTimestamp,
                raw: np,
            };
        }).filter(r => !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [nodePools, searchQuery]);

    const capacityChartData = useMemo(() => {
        return nodePoolRows.map(r => ({
            name: r.name,
            cpu: Math.round(r.cpuUsed / 1000),
            memory: Math.round(r.memUsed),
        }));
    }, [nodePoolRows]);

    const nodeClaimStatusData = useMemo(() => {
        const counts: Record<string, number> = {};
        nodeClaims.forEach(nc => {
            const conditions = nc.status?.conditions || [];
            const ready = conditions.some((c: any) => c.type === 'Ready' && c.status === 'True');
            const initialized = conditions.some((c: any) => c.type === 'Initialized' && c.status === 'True');
            let status = 'Pending';
            if (ready) status = 'Ready';
            else if (initialized) status = 'Initializing';
            counts[status] = (counts[status] || 0) + 1;
        });
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [nodeClaims]);

    // --- Events ---

    const filteredEvents = useMemo(() => {
        if (eventFilter === 'all') return events;
        return events.filter(e => categorizeEvent(e.reason) === eventFilter);
    }, [events, eventFilter]);

    const eventTotalPages = Math.ceil(filteredEvents.length / EVENTS_PER_PAGE);
    const paginatedEvents = useMemo(
        () => filteredEvents.slice((eventPage - 1) * EVENTS_PER_PAGE, eventPage * EVENTS_PER_PAGE),
        [filteredEvents, eventPage]
    );

    // Reset page on filter change
    useEffect(() => { setEventPage(1); }, [eventFilter]);

    const eventCategoryCounts = useMemo(() => {
        const counts: Record<string, number> = { all: events.length };
        events.forEach(e => {
            const cat = categorizeEvent(e.reason);
            counts[cat] = (counts[cat] || 0) + 1;
        });
        return counts;
    }, [events]);

    // --- Render ---

    const cardStyles = "bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-between hover:bg-white/[0.07] transition-colors";

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
            </div>
        );
    }

    const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="p-6 space-y-8 pb-20">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <div className="w-1 h-8 bg-orange-500 rounded-full"></div>
                        Karpenter
                        <span className="text-sm font-normal text-gray-400 bg-white/5 px-2 py-1 rounded-md ml-2">
                            {stats.totalPools} NodePool{stats.totalPools !== 1 ? 's' : ''}
                        </span>
                    </h2>
                    <button
                        onClick={() => { setLoading(true); fetchData().then(() => fetchEvents()); }}
                        className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
                    >
                        <RefreshCw size={16} />
                    </button>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    <div className={cardStyles}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">NodePools</span>
                            <Settings size={14} className="text-blue-400" />
                        </div>
                        <div className="text-2xl font-bold text-white">{stats.totalPools}</div>
                        <div className="text-xs text-gray-500 mt-1">{stats.readyPools} ready</div>
                    </div>
                    <div className={cardStyles}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">NodeClaims</span>
                            <Box size={14} className="text-purple-400" />
                        </div>
                        <div className="text-2xl font-bold text-white">{stats.totalNodeClaims}</div>
                    </div>
                    <div className={cardStyles}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Nodes</span>
                            <Server size={14} className="text-green-400" />
                        </div>
                        <div className="text-2xl font-bold text-white">{stats.totalNodes}</div>
                    </div>
                    <div className={cardStyles}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">EC2NodeClasses</span>
                            <Zap size={14} className="text-orange-400" />
                        </div>
                        <div className="text-2xl font-bold text-white">{stats.totalNodeClasses}</div>
                    </div>
                    <div className={cardStyles}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total vCPU</span>
                            <Cpu size={14} className="text-blue-400" />
                        </div>
                        <div className="text-2xl font-bold text-white">{formatCpu(stats.usedCpuMillis)}</div>
                        {stats.totalCpuMillis > 0 && (
                            <div className="text-xs text-gray-500 mt-1">of {formatCpu(stats.totalCpuMillis)} limit</div>
                        )}
                    </div>
                    <div className={cardStyles}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Memory</span>
                            <HardDrive size={14} className="text-purple-400" />
                        </div>
                        <div className="text-2xl font-bold text-white">{formatMemory(stats.usedMemoryGi)}</div>
                        {stats.totalMemoryGi > 0 && (
                            <div className="text-xs text-gray-500 mt-1">of {formatMemory(stats.totalMemoryGi)} limit</div>
                        )}
                    </div>
                </div>

                {/* NodePool Table */}
                <section>
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                        <Settings size={18} className="text-blue-400" />
                        NodePools
                    </h3>
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10">
                                    {['Name', 'Status', 'Nodes', 'CPU Used', 'Memory Used', 'Consolidation', 'Weight', 'NodeClass', 'Age'].map(h => (
                                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {nodePoolRows.length === 0 ? (
                                    <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500 italic">No NodePools found</td></tr>
                                ) : nodePoolRows.map(row => (
                                    <tr key={row.name} className="hover:bg-white/[0.03] transition-colors">
                                        <td className="px-4 py-3 font-medium text-gray-200">{row.name}</td>
                                        <td className="px-4 py-3">
                                            <span className={`flex items-center gap-1.5 text-xs font-medium ${row.ready ? 'text-green-400' : 'text-yellow-400'}`}>
                                                {row.ready ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                                                {row.ready ? 'Ready' : 'Not Ready'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-300 font-mono">{row.nodes}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col">
                                                <span className="text-gray-200 font-mono text-xs">{formatCpu(row.cpuUsed)}</span>
                                                {row.cpuLimit > 0 && (
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <div className="flex-1 h-1.5 bg-blue-500/20 rounded-full overflow-hidden max-w-[80px]">
                                                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, (row.cpuUsed / row.cpuLimit) * 100)}%` }} />
                                                        </div>
                                                        <span className="text-[10px] text-gray-500">{Math.round((row.cpuUsed / row.cpuLimit) * 100)}%</span>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col">
                                                <span className="text-gray-200 font-mono text-xs">{formatMemory(row.memUsed)}</span>
                                                {row.memLimit > 0 && (
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <div className="flex-1 h-1.5 bg-purple-500/20 rounded-full overflow-hidden max-w-[80px]">
                                                            <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min(100, (row.memUsed / row.memLimit) * 100)}%` }} />
                                                        </div>
                                                        <span className="text-[10px] text-gray-500">{Math.round((row.memUsed / row.memLimit) * 100)}%</span>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="text-xs text-gray-400 font-mono">{row.consolidationPolicy}</span>
                                            {row.consolidateAfter !== '-' && (
                                                <span className="text-[10px] text-gray-500 block">{row.consolidateAfter}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-gray-300 font-mono text-xs">{row.weight}</td>
                                        <td className="px-4 py-3">
                                            <span className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">{row.nodeClassRef}</span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-400 text-xs"><TimeAgo timestamp={row.age} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Charts Row */}
                {nodePoolRows.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Capacity per NodePool */}
                        <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col h-72">
                            <h3 className="text-sm font-semibold text-white mb-4">Capacity per NodePool</h3>
                            <div className="flex-1 w-full min-h-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={capacityChartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                                        <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                                        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10, fill: '#9ca3af' }} interval={0} />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                            contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }}
                                            itemStyle={{ color: '#E5E7EB' }}
                                            formatter={(value: any, name?: string) => [name === 'cpu' ? `${value} vCPU` : `${value} GiB`, name === 'cpu' ? 'CPU' : 'Memory']}
                                        />
                                        <Legend />
                                        <Bar dataKey="cpu" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={14} name="CPU (vCPU)" />
                                        <Bar dataKey="memory" fill="#a855f7" radius={[0, 4, 4, 0]} barSize={14} name="Memory (GiB)" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* NodeClaim Status Distribution */}
                        <div className="bg-white/5 border border-white/10 rounded-xl p-6 flex flex-col h-72">
                            <h3 className="text-sm font-semibold text-white mb-4">NodeClaim Status</h3>
                            <div className="flex-1 w-full min-h-0">
                                {nodeClaimStatusData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={nodeClaimStatusData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={5} dataKey="value">
                                                {nodeClaimStatusData.map((_entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="rgba(0,0,0,0.2)" />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px' }} itemStyle={{ color: '#E5E7EB' }} />
                                            <Legend verticalAlign="bottom" />
                                        </PieChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-gray-500 text-sm">No NodeClaims</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Events Section */}
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <Activity size={18} className="text-yellow-400" />
                            Karpenter Events
                            {events.length > 0 && (
                                <span className="bg-white/10 px-2 py-0.5 rounded text-xs text-gray-400 font-normal">{events.length}</span>
                            )}
                        </h3>
                    </div>

                    {/* Event Category Filters */}
                    <div className="flex flex-wrap gap-2 mb-4">
                        {[
                            { key: 'all', label: 'All', icon: Activity, color: 'text-gray-300' },
                            { key: 'disruption', label: 'Disruption', icon: XCircle, color: 'text-red-400' },
                            { key: 'provisioning', label: 'Provisioning', icon: Zap, color: 'text-blue-400' },
                            { key: 'deprovisioning', label: 'Deprovisioning', icon: Clock, color: 'text-yellow-400' },
                            { key: 'health', label: 'Health', icon: Shield, color: 'text-green-400' },
                            { key: 'other', label: 'Other', icon: AlertTriangle, color: 'text-gray-400' },
                        ].map(({ key, label, icon: Icon, color }) => {
                            const count = eventCategoryCounts[key] || 0;
                            const isActive = eventFilter === key;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setEventFilter(key)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                        isActive
                                            ? 'bg-white/10 border-white/20 text-white'
                                            : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/[0.07]'
                                    }`}
                                >
                                    <Icon size={12} className={isActive ? color : ''} />
                                    {label}
                                    {count > 0 && (
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${isActive ? 'bg-white/10' : 'bg-white/5'}`}>
                                            {count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Event List */}
                    {paginatedEvents.length === 0 ? (
                        <div className="bg-white/5 rounded-xl p-8 border border-white/10 text-gray-500 italic text-center text-sm">
                            {events.length === 0 ? 'No Karpenter events found.' : 'No events match this filter.'}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {paginatedEvents.map((event, i) => {
                                const cat = categorizeEvent(event.reason);
                                const catDef = EVENT_CATEGORIES[cat];
                                const colorClass = catDef?.color || 'text-gray-400';
                                return (
                                    <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs hover:bg-white/[0.07] transition-colors">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-2">
                                                <span className={`font-bold ${colorClass}`}>{event.reason}</span>
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                                    event.type === 'Warning'
                                                        ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                                                        : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                                }`}>
                                                    {event.type}
                                                </span>
                                                {catDef && (
                                                    <span className="text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">{catDef.label}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 text-gray-500">
                                                {event.count > 1 && (
                                                    <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-gray-400">{event.count}x</span>
                                                )}
                                                <TimeAgo timestamp={event.lastTimestamp} />
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <span className="text-gray-500 font-mono shrink-0">{event.object}</span>
                                            <span className="text-gray-300 break-words leading-relaxed">{event.message}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Pagination */}
                    {eventTotalPages > 1 && (
                        <div className="flex justify-center items-center gap-2 mt-4">
                            <button
                                onClick={() => setEventPage(p => Math.max(1, p - 1))}
                                disabled={eventPage === 1}
                                className="p-1 rounded hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-gray-400"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <span className="text-xs text-gray-400">Page {eventPage} of {eventTotalPages}</span>
                            <button
                                onClick={() => setEventPage(p => Math.min(eventTotalPages, p + 1))}
                                disabled={eventPage === eventTotalPages}
                                className="p-1 rounded hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-gray-400"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};
