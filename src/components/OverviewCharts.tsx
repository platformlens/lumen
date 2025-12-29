import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { Box, Layers } from 'lucide-react';

interface OverviewChartsProps {
  pods: any[];
  deployments: any[];
  nodes?: any[];
  onViewDetails?: () => void;
}

const COLORS = {
  running: '#22c55e', // green-500
  pending: '#eab308', // yellow-500
  failed: '#ef4444', // red-500
  succeeded: '#3b82f6', // blue-500
  unknown: '#6b7280', // gray-500
};

export const OverviewCharts: React.FC<OverviewChartsProps> = ({ pods = [], deployments = [], onViewDetails }) => {
  
  const podStats = useMemo(() => {
    const stats: Record<string, number> = {
      Running: 0,
      Pending: 0,
      Failed: 0,
      Succeeded: 0,
      Unknown: 0
    };
    
    pods.forEach(pod => {
      const status = pod.status || 'Unknown';
      if (stats[status] !== undefined) {
        stats[status]++;
      } else {
        stats['Unknown']++;
      }
    });

    return Object.entries(stats)
      .filter(([_, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [pods]);

  const deploymentStats = useMemo(() => {
    const total = deployments.length;
    let ready = 0;
    
    deployments.forEach(d => {
       if (d.availableReplicas === d.replicas && d.replicas > 0) {
           ready++;
       }
    });
    
    return [
        { name: 'Ready', value: ready },
        { name: 'Not Ready', value: total - ready }
    ];
  }, [deployments]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      {/* Pod Status Chart */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6 relative overflow-hidden group hover:border-white/20 transition-colors">
        <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Box size={20} className="text-green-400"/> Pod Status
            </h3>
            {onViewDetails && (
                <button 
                    onClick={onViewDetails}
                    className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors group-hover:bg-white/10"
                    title="View Detailed Visualization"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14" />
                        <path d="M12 5l7 7-7 7" />
                    </svg>
                </button>
            )}
        </div>
        <div className="h-64 w-full">
            {podStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={podStats}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                        >
                            {podStats.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[entry.name.toLowerCase() as keyof typeof COLORS] || COLORS.unknown} />
                            ))}
                        </Pie>
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px' }}
                            itemStyle={{ color: '#fff' }}
                        />
                        <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                </ResponsiveContainer>
            ) : (
                <div className="h-full flex items-center justify-center text-gray-500 italic">
                    No pods found
                </div>
            )}
        </div>
      </div>

      {/* Deployment Health Chart */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6 relative overflow-hidden group hover:border-white/20 transition-colors">
        <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <Layers size={20} className="text-blue-400"/> Deployment Health
        </h3>
        <div className="h-64 w-full">
            {deployments.length > 0 ? (
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deploymentStats} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" stroke="#9ca3af" width={80} tick={{fontSize: 12}} />
                        <Tooltip 
                            cursor={{fill: 'rgba(255,255,255,0.05)'}}
                            contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px' }}
                            itemStyle={{ color: '#fff' }}
                        />
                        <Bar dataKey="value" barSize={20} radius={[0, 4, 4, 0]}>
                            {deploymentStats.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.name === 'Ready' ? '#22c55e' : '#ef4444'} />
                            ))}
                        </Bar>
                    </BarChart>
                 </ResponsiveContainer>
            ) : (
                <div className="h-full flex items-center justify-center text-gray-500 italic">
                    No deployments found
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
