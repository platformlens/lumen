import React, { useMemo } from 'react';
import type { V1Affinity, V1LabelSelector, V1NodeSelectorTerm, V1PodAffinityTerm, V1Toleration, V1TopologySpreadConstraint } from '@kubernetes/client-node';
import type { Jsonified, PodTemplate } from '../../../../types/deployment-details';
import { SectionShell } from './SectionShell';
import { Disclosure } from './Disclosure';

interface SchedulingConstraintsProps {
    namespace: string;
    template: PodTemplate;
}

type Affinity = Jsonified<V1Affinity>;
type Toleration = Jsonified<V1Toleration>;
type Tsc = Jsonified<V1TopologySpreadConstraint>;
type Selector = Jsonified<V1LabelSelector>;

const expr = (e: { key: string; operator: string; values?: string[] }) =>
    e.values?.length ? `${e.key} ${e.operator} [${e.values.join(', ')}]` : `${e.key} ${e.operator}`;

function termText(term: Jsonified<V1NodeSelectorTerm>): string {
    const parts = [
        ...(term.matchExpressions ?? []).map(expr),
        ...(term.matchFields ?? []).map(e => `field ${expr(e)}`),
    ];
    return parts.length ? parts.join(' AND ') : '(empty term)';
}

function selectorText(sel: Selector | undefined): string {
    if (!sel) return '(no selector)';
    const parts = [
        ...Object.entries(sel.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`),
        ...(sel.matchExpressions ?? []).map(expr),
    ];
    return parts.length ? parts.join(', ') : '(all pods)';
}

function podTermText(t: Jsonified<V1PodAffinityTerm>): string {
    const ns = t.namespaces?.length ? ` in ns [${t.namespaces.join(', ')}]` : '';
    return `topologyKey ${t.topologyKey}: ${selectorText(t.labelSelector)}${ns}`;
}

function tolerationText(t: Toleration): string {
    const op = t.operator ?? 'Equal';
    const key = t.key ?? '*';
    const base = op === 'Exists' ? `${key} Exists` : `${key}=${t.value ?? ''}`;
    const effect = t.effect ? `:${t.effect}` : ' (all effects)';
    const secs = typeof t.tolerationSeconds === 'number' ? ` for ${t.tolerationSeconds}s` : '';
    return `${base}${effect}${secs}`;
}

function tscText(t: Tsc): string {
    const min = typeof t.minDomains === 'number' ? `, minDomains ${t.minDomains}` : '';
    return `maxSkew ${t.maxSkew} on ${t.topologyKey}, ${t.whenUnsatisfiable}${min} — ${selectorText(t.labelSelector)}`;
}

interface Rule { text: string; weight?: number }

function podAffinityRules(a: Affinity['podAffinity'] | Affinity['podAntiAffinity']): { required: Rule[]; preferred: Rule[] } {
    return {
        required: (a?.requiredDuringSchedulingIgnoredDuringExecution ?? []).map(t => ({ text: podTermText(t) })),
        preferred: (a?.preferredDuringSchedulingIgnoredDuringExecution ?? []).map(w => ({ text: podTermText(w.podAffinityTerm), weight: w.weight })),
    };
}

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="font-mono text-xs text-gray-300 bg-white/5 border border-white/10 px-2 py-0.5 rounded-md break-all">{children}</span>
);

const Group: React.FC<{ label: string; rules: { required: Rule[]; preferred: Rule[] } }> = ({ label, rules }) => {
    if (rules.required.length === 0 && rules.preferred.length === 0) return null;
    return (
        <div>
            <div className="text-xs text-gray-400 mb-1">{label}</div>
            <ul className="space-y-1">
                {rules.required.map((r, i) => (
                    <li key={`r-${i}`} className="flex flex-wrap items-start gap-2 text-xs">
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">Required</span>
                        <span className="font-mono text-gray-300 break-all min-w-0">{r.text}</span>
                    </li>
                ))}
                {rules.preferred.map((r, i) => (
                    <li key={`p-${i}`} className="flex flex-wrap items-start gap-2 text-xs">
                        <span className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300 border border-white/10">Preferred (weight {r.weight})</span>
                        <span className="font-mono text-gray-300 break-all min-w-0">{r.text}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="min-w-0">
        <dt className="text-xs text-gray-400">{label}</dt>
        <dd className="text-sm text-gray-300 font-mono break-all">{value}</dd>
    </div>
);

const SchedulingConstraintsInner: React.FC<SchedulingConstraintsProps> = ({ namespace, template }) => {
    const spec = template.spec;
    const view = useMemo(() => {
        const affinity: Affinity = spec?.affinity ?? {};
        const na = affinity.nodeAffinity;
        const nodeAffinity = {
            required: (na?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms ?? []).map(t => ({ text: termText(t) })),
            preferred: (na?.preferredDuringSchedulingIgnoredDuringExecution ?? []).map(p => ({ text: termText(p.preference), weight: p.weight })),
        };
        // Raw JSON: ONLY the 8 scheduling fields — never the whole template.spec (env literals stay masked, §5.5).
        const raw = {
            nodeSelector: spec?.nodeSelector,
            affinity: spec?.affinity,
            tolerations: spec?.tolerations,
            topologySpreadConstraints: spec?.topologySpreadConstraints,
            priorityClassName: spec?.priorityClassName,
            schedulerName: spec?.schedulerName,
            runtimeClassName: spec?.runtimeClassName,
            terminationGracePeriodSeconds: spec?.terminationGracePeriodSeconds,
        };
        return {
            nodeSelector: Object.entries(spec?.nodeSelector ?? {}),
            nodeAffinity,
            podAffinity: podAffinityRules(affinity.podAffinity),
            podAntiAffinity: podAffinityRules(affinity.podAntiAffinity),
            tolerations: (spec?.tolerations ?? []).map(tolerationText),
            tscs: (spec?.topologySpreadConstraints ?? []).map(tscText),
            rawJson: JSON.stringify(raw, null, 2),
        };
    }, [spec]);

    const noRules = view.nodeSelector.length === 0 && view.tolerations.length === 0 && view.tscs.length === 0
        && [view.nodeAffinity, view.podAffinity, view.podAntiAffinity].every(r => r.required.length === 0 && r.preferred.length === 0);

    return (
        <SectionShell id="scheduling" title="Scheduling Constraints" namespace={namespace}>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Fact label="Priority class" value={spec?.priorityClassName ?? '–'} />
                    <Fact label="Scheduler" value={spec?.schedulerName ?? 'default-scheduler'} />
                    <Fact label="Runtime class" value={spec?.runtimeClassName ?? '–'} />
                    <Fact label="Termination grace period" value={`${spec?.terminationGracePeriodSeconds ?? 30}s`} />
                </dl>
                {noRules && <p className="text-sm text-gray-400">No node selectors, affinity rules, tolerations or topology spread constraints; pods can schedule on any node.</p>}
                {view.nodeSelector.length > 0 && (
                    <div>
                        <div className="text-xs text-gray-400 mb-1">Node selector</div>
                        <div className="flex flex-wrap gap-1.5">{view.nodeSelector.map(([k, v]) => <Chip key={k}>{k}={v}</Chip>)}</div>
                    </div>
                )}
                <Group label="Node affinity" rules={view.nodeAffinity} />
                <Group label="Pod affinity" rules={view.podAffinity} />
                <Group label="Pod anti-affinity" rules={view.podAntiAffinity} />
                {view.tolerations.length > 0 && (
                    <div>
                        <div className="text-xs text-gray-400 mb-1">Tolerations</div>
                        <div className="flex flex-wrap gap-1.5">{view.tolerations.map((t, i) => <Chip key={`${t}-${i}`}>{t}</Chip>)}</div>
                    </div>
                )}
                {view.tscs.length > 0 && (
                    <div>
                        <div className="text-xs text-gray-400 mb-1">Topology spread constraints</div>
                        <ul className="space-y-1">{view.tscs.map((t, i) => <li key={`${t}-${i}`} className="font-mono text-xs text-gray-300 break-all">{t}</li>)}</ul>
                    </div>
                )}
                <Disclosure title="Raw scheduling JSON" className="border-t border-white/10 pt-3">
                    <pre className="font-mono text-xs text-gray-300 bg-black/40 border border-white/10 rounded-lg p-3 overflow-auto max-h-80">{view.rawJson}</pre>
                </Disclosure>
            </div>
        </SectionShell>
    );
};

export const SchedulingConstraints = React.memo(SchedulingConstraintsInner);
