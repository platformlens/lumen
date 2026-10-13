import React, { useMemo } from 'react';
import { AlertTriangle, ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import type { NamespaceSummary, SectionResult } from '../../../../types/deployment-details';
import type { CheckLevel, SecurityCheck, SecurityPostureReport } from '../../../../utils/security-posture-utils';
import { LevelBadge, SectionShell, SectionUnavailable } from './SectionShell';
import { STATUS_CLASSES, type StatusColor } from './status-classes';

interface SecurityPostureProps {
    namespace: string;
    report: SecurityPostureReport;
    namespaceInfo: SectionResult<NamespaceSummary>;
}

type PssLevel = SecurityPostureReport['pssLevel'];
const PSS_RANK: Record<PssLevel, number> = { privileged: 0, baseline: 1, restricted: 2 };
const PSS_META: Record<PssLevel, { color: StatusColor; Icon: typeof ShieldCheck; label: string }> = {
    restricted: { color: 'green', Icon: ShieldCheck, label: 'Restricted' },
    baseline: { color: 'yellow', Icon: ShieldHalf, label: 'Baseline' },
    privileged: { color: 'red', Icon: ShieldAlert, label: 'Privileged' },
};
const LEVEL_RANK: Record<CheckLevel, number> = { pass: 0, info: 1, warn: 2, fail: 3 };
const LEVEL_TEXT: Record<CheckLevel, string> = { pass: 'Pass', info: 'Info', warn: 'Warn', fail: 'Fail' };

const ROW_LABELS: Record<string, string> = {
    'run-as-root': 'Run as non-root',
    'run-as-group': 'Run as group',
    privileged: 'Privileged',
    'allow-privilege-escalation': 'Privilege escalation',
    'read-only-root-fs': 'Read-only root FS',
    'capabilities-drop': 'Drop ALL capabilities',
    'capabilities-add': 'Added capabilities',
    seccomp: 'seccomp profile',
    apparmor: 'AppArmor',
    selinux: 'SELinux',
    'proc-mount': '/proc mount',
    'host-port': 'Host ports',
};

const isPssLevel = (v: string | null): v is PssLevel => v === 'privileged' || v === 'baseline' || v === 'restricted';

const checkTitle = (c: SecurityCheck) =>
    `${c.title}: ${c.detail}${c.pssViolation && c.pss ? ` · PSS ${c.pss}` : ''}`;

interface MatrixCell { level: CheckLevel; label?: string; title: string }

/** Rows = container check ids (first-seen order), columns = containers. Per-cap checks collapse into one row. */
function buildMatrix(report: SecurityPostureReport): { columns: string[]; rows: { id: string; cells: (MatrixCell | null)[] }[] } {
    const columns = report.containers.map(c => c.container);
    const rowIds: string[] = [];
    const byKey = new Map<string, SecurityCheck[]>();
    for (const c of report.checks) {
        if (c.scope !== 'container' || c.container === null) continue;
        if (!rowIds.includes(c.id)) rowIds.push(c.id);
        const key = `${c.id}\u0000${c.container}`;
        const list = byKey.get(key);
        if (list) list.push(c); else byKey.set(key, [c]);
    }
    const rows = rowIds.map(id => ({
        id,
        cells: columns.map((col): MatrixCell | null => {
            const checks = byKey.get(`${id}\u0000${col}`);
            if (!checks || checks.length === 0) return null;
            if (checks.length === 1 && !(id === 'capabilities-add' && checks[0].level !== 'pass')) {
                return { level: checks[0].level, title: checkTitle(checks[0]) };
            }
            const worst = checks.reduce((w, c) => (LEVEL_RANK[c.level] > LEVEL_RANK[w.level] ? c : w));
            const caps = checks.map(c => c.detail.replace(/^capabilities\.add includes /, ''));
            return { level: worst.level, label: `${LEVEL_TEXT[worst.level]}: ${caps.join(', ')}`, title: checks.map(checkTitle).join('\n') };
        }),
    }));
    return { columns, rows };
}

const SecurityPostureInner: React.FC<SecurityPostureProps> = ({ namespace, report, namespaceInfo }) => {
    const matrix = useMemo(() => buildMatrix(report), [report]);
    const podChecks = useMemo(() => report.checks.filter(c => c.scope === 'pod'), [report]);
    const pss = PSS_META[report.pssLevel];
    const enforce = namespaceInfo.status === 'ok' ? namespaceInfo.data.podSecurity.enforce : null;
    const enforceVersion = namespaceInfo.status === 'ok' ? namespaceInfo.data.podSecurity.enforceVersion : null;
    const rejected = isPssLevel(enforce) && PSS_RANK[report.pssLevel] < PSS_RANK[enforce];

    return (
        <SectionShell id="security" title="Security Posture" namespace={namespace}>
            <div className="space-y-4">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-wrap items-center gap-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-semibold ${STATUS_CLASSES[pss.color]}`}
                        title="Approximation of the Pod Security Standards level this pod template satisfies">
                        <pss.Icon size={16} aria-hidden="true" /> PSS {pss.label} <span className="text-xs font-normal opacity-80">(approx.)</span>
                    </span>
                    {namespaceInfo.status === 'ok' && (
                        <span className="text-sm text-gray-400 bg-white/5 px-2 py-1 rounded-md">
                            Namespace enforce: <span className="font-mono text-gray-300">{enforce ?? 'not set'}{enforce && enforceVersion ? `@${enforceVersion}` : ''}</span>
                        </span>
                    )}
                    <div className="flex flex-wrap gap-1.5 ml-auto">
                        <LevelBadge level="pass" label={`${report.counts.pass} pass`} />
                        <LevelBadge level="warn" label={`${report.counts.warn} warn`} />
                        <LevelBadge level="fail" label={`${report.counts.fail} fail`} />
                        <LevelBadge level="info" label={`${report.counts.info} info`} />
                    </div>
                    {rejected && (
                        <div className="basis-full flex items-center gap-2 text-xs text-red-400">
                            <AlertTriangle size={14} aria-hidden="true" /> New pods would be rejected by namespace enforcement ({enforce})
                        </div>
                    )}
                </div>
                {namespaceInfo.status === 'forbidden' && <SectionUnavailable kind="forbidden" label="read namespaces" namespace={namespace} scope="cluster" />}
                {namespaceInfo.status === 'error' && <SectionUnavailable kind="error" message={namespaceInfo.message} />}

                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    <div className="px-4 py-2 bg-white/5 border-b border-white/10 text-xs font-medium text-gray-400">Pod-level checks</div>
                    <ul className="divide-y divide-white/5">
                        {podChecks.map((c, i) => (
                            <li key={`${c.id}-${i}`} className="px-4 py-2 flex flex-wrap items-start gap-3 text-sm">
                                <span className="shrink-0 w-16"><LevelBadge level={c.level} /></span>
                                <span className="text-gray-300 min-w-0">{c.title}</span>
                                <span className="basis-full sm:basis-auto sm:ml-auto text-xs text-gray-400 font-mono break-all min-w-0">
                                    {c.detail}{c.pssViolation && c.pss ? ` · PSS ${c.pss}` : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                {matrix.columns.length > 0 && (
                    <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
                        <table className="w-full text-sm">
                            <caption className="sr-only">Per-container security checks</caption>
                            <thead className="bg-white/5 text-gray-400 font-medium border-b border-white/10">
                                <tr>
                                    <th scope="col" className="text-left px-4 py-2 text-xs">Check</th>
                                    {matrix.columns.map(c => <th key={c} scope="col" className="text-left px-4 py-2 text-xs font-mono">{c}</th>)}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {matrix.rows.map(r => (
                                    <tr key={r.id} className="hover:bg-white/5 transition-colors">
                                        <th scope="row" className="text-left px-4 py-2 text-xs font-normal text-gray-300 whitespace-nowrap">{ROW_LABELS[r.id] ?? r.id}</th>
                                        {r.cells.map((cell, i) => (
                                            <td key={matrix.columns[i]} className="px-4 py-2">
                                                {cell ? <LevelBadge level={cell.level} label={cell.label} title={cell.title} /> : <span className="text-gray-600">–</span>}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </SectionShell>
    );
};

export const SecurityPosture = React.memo(SecurityPostureInner);
