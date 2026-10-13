import React, { useMemo } from 'react';
import type { ContainerInsight } from '../../../../utils/container-insights-utils';
import { SectionShell } from './SectionShell';
import { ContainerCard } from './ContainerCard';

interface ContainersSectionProps {
    namespace: string;
    insights: ContainerInsight[];
    onOpenConfigMap: (name: string) => void;
}

const GROUPS: { kind: ContainerInsight['kind']; label: string }[] = [
    { kind: 'init', label: 'Init containers' },
    { kind: 'sidecar', label: 'Sidecars' },
    { kind: 'main', label: 'Containers' },
];

const ContainersSectionInner: React.FC<ContainersSectionProps> = ({ namespace, insights, onOpenConfigMap }) => {
    const groups = useMemo(
        () => GROUPS.map(g => ({ ...g, items: insights.filter(i => i.kind === g.kind) })).filter(g => g.items.length > 0),
        [insights]);

    return (
        <SectionShell id="containers" title="Containers" namespace={namespace}>
            {groups.length === 0 ? (
                <p className="text-sm text-gray-400 bg-white/5 border border-white/10 rounded-xl p-4">The pod template defines no containers.</p>
            ) : (
                <div className="space-y-5">
                    {groups.map(g => (
                        <div key={g.kind} className="space-y-2">
                            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                                {g.label}
                                <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs text-white">{g.items.length}</span>
                            </h3>
                            {g.items.map(i => (
                                <ContainerCard key={`${i.kind}-${i.name}`} insight={i} defaultOpen={i.kind === 'main'} onOpenConfigMap={onOpenConfigMap} />
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </SectionShell>
    );
};

export const ContainersSection = React.memo(ContainersSectionInner);
