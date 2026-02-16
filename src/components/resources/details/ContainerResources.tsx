import React from 'react';
import { Cpu } from 'lucide-react';

interface ContainerResourcesProps {
    container: any;
}

export const ContainerResources: React.FC<ContainerResourcesProps> = ({ container }) => {
    if (!container.resources || (!container.resources.limits && !container.resources.requests)) {
        return null;
    }

    return (
        <div className="mt-4">
            <span className="text-gray-500 text-xs uppercase font-bold block mb-2 flex items-center gap-2">
                <Cpu size={14} /> Resources
            </span>
            <div className="grid grid-cols-2 gap-4 bg-black/40 p-3 rounded border border-white/10">
                {/* Requests */}
                <div>
                    <span className="text-gray-500 text-[10px] uppercase block mb-1 font-bold">Requests</span>
                    <div className="flex flex-col gap-1">
                        {container.resources.requests?.cpu && (
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-gray-400 w-16">CPU</span>
                                <span className="text-white font-mono">{container.resources.requests.cpu}</span>
                            </div>
                        )}
                        {container.resources.requests?.memory && (
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-gray-400 w-16">Memory</span>
                                <span className="text-white font-mono">{container.resources.requests.memory}</span>
                            </div>
                        )}
                        {!container.resources.requests?.cpu && !container.resources.requests?.memory && (
                            <span className="text-gray-500 italic text-xs">None</span>
                        )}
                    </div>
                </div>

                {/* Limits */}
                <div>
                    <span className="text-gray-500 text-[10px] uppercase block mb-1 font-bold">Limits</span>
                    <div className="flex flex-col gap-1">
                        {container.resources.limits?.cpu && (
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-gray-400 w-16">CPU</span>
                                <span className="text-white font-mono">{container.resources.limits.cpu}</span>
                            </div>
                        )}
                        {container.resources.limits?.memory && (
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-gray-400 w-16">Memory</span>
                                <span className="text-white font-mono">{container.resources.limits.memory}</span>
                            </div>
                        )}
                        {!container.resources.limits?.cpu && !container.resources.limits?.memory && (
                            <span className="text-gray-500 italic text-xs">None</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
