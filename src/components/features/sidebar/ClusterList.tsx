import React, { useEffect, useState } from 'react';
import { Server, CheckCircle2 } from 'lucide-react';

interface Cluster {
  name: string;
  cluster: any;
  user: any;
}

interface ClusterListProps {
  onSelect: (clusterName: string) => void;
}

export const ClusterList: React.FC<ClusterListProps> = ({ onSelect }) => {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const list = await window.k8s.getClusters();
        setClusters(list);
      } catch (e) {
        console.error("Failed to load clusters", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="p-8 text-gray-400">Loading clusters...</div>;

  return (
    <div className="p-8 w-full max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-white">Clusters</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {clusters.map((c) => (
          <div 
            key={c.name}
            onClick={() => onSelect(c.name)}
            className="bg-[#2a2a2a] p-6 rounded-xl border border-[#333] hover:border-blue-500 hover:bg-[#333] cursor-pointer transition-all duration-200 group"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                  <Server size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-white">{c.name}</h3>
                  <p className="text-sm text-gray-400">{c.cluster.server}</p>
                </div>
              </div>
              <CheckCircle2 size={20} className="text-gray-600 group-hover:text-blue-500" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
