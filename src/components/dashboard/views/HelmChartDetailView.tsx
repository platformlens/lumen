import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import {
    ArrowLeft,
    BookOpen,
    Clipboard,
    ExternalLink,
    FileJson,
    FileText,
    History,
    LayoutDashboard,
    Loader2,
    Search,
} from 'lucide-react';
import { GlassButton } from '../../shared/GlassButton';
import {
    helmChartHubWebUrl,
    fetchHelmChartValuesYaml,
    fetchHelmChangelogMd,
    fetchHelmPackage,
    fetchHelmPackageVersion,
    fetchHelmValuesSchema,
    type HelmPackageDetail,
} from '../../../lib/artifacthub';

type DetailTab = 'overview' | 'readme' | 'values' | 'schema' | 'changelog';

const HELM_MARKDOWN_COMPONENTS: Components = {
    table({ children, ...props }) {
        return (
            <div className="overflow-x-auto my-4 w-full not-prose">
                <table {...props} className="w-full border-collapse text-xs">
                    {children}
                </table>
            </div>
        );
    },
    thead: props => <thead {...props} className="border-b border-white/20" />,
    th: props => (
        <th {...props} className="border border-white/15 bg-white/5 px-2 py-1.5 text-left font-semibold text-gray-200" />
    ),
    td: props => <td {...props} className="border border-white/10 px-2 py-1.5 align-top text-gray-300" />,
    tr: props => <tr {...props} className="even:bg-white/[0.03]" />,
};

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightMatches({ text, query }: { text: string; query: string }): React.ReactNode {
    const q = query.trim();
    if (!q) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'));
    return (
        <>
            {parts.map((part, i) =>
                part.toLowerCase() === q.toLowerCase() ? (
                    <mark key={i} className="bg-amber-500/35 text-amber-100 rounded px-0.5">
                        {part}
                    </mark>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </>
    );
}

interface HelmChartDetailViewProps {
    repoName: string;
    chartName: string;
    onBack: () => void;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const HelmChartDetailView: React.FC<HelmChartDetailViewProps> = ({
    repoName,
    chartName,
    onBack,
    showToast,
}) => {
    const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
    const [detail, setDetail] = useState<HelmPackageDetail | null>(null);
    const [valuesYaml, setValuesYaml] = useState<string>('');
    const [valuesError, setValuesError] = useState<string | null>(null);
    const [schemaJson, setSchemaJson] = useState<unknown | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [tab, setTab] = useState<DetailTab>('overview');
    const [valuesQuery, setValuesQuery] = useState('');
    const [schemaQuery, setSchemaQuery] = useState('');
    const [changelogMd, setChangelogMd] = useState<string>('');
    const [addingRepo, setAddingRepo] = useState(false);

    useEffect(() => {
        setSelectedVersion(null);
        setDetail(null);
        setValuesYaml('');
        setSchemaJson(null);
        setLoadError(null);
        setValuesError(null);
        setTab('overview');
        setValuesQuery('');
        setSchemaQuery('');
        setChangelogMd('');
    }, [repoName, chartName]);

    useEffect(() => {
        if (!detail) return;
        if (tab === 'schema' && !detail.has_values_schema) {
            setTab('overview');
        } else if (tab === 'changelog' && !detail.has_changelog) {
            setTab('overview');
        }
    }, [detail, tab]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            setLoading(true);
            setLoadError(null);
            setValuesError(null);
            try {
                if (selectedVersion === null) {
                    const d = await fetchHelmPackage(repoName, chartName);
                    if (cancelled) return;
                    setDetail(d);
                    setSelectedVersion(d.version);
                    return;
                }

                const verDetail = await fetchHelmPackageVersion(repoName, chartName, selectedVersion);
                if (cancelled) return;
                setDetail(verDetail);

                let yaml = '';
                let schema: unknown | null = null;
                try {
                    const [y, s] = await Promise.all([
                        fetchHelmChartValuesYaml(verDetail.package_id, selectedVersion),
                        verDetail.has_values_schema
                            ? fetchHelmValuesSchema(verDetail.package_id, selectedVersion)
                            : Promise.resolve(null),
                    ]);
                    yaml = y;
                    schema = s;
                } catch (ve: any) {
                    if (!cancelled) setValuesError(String(ve?.message ?? ve));
                }
                if (cancelled) return;
                setValuesYaml(yaml);
                setSchemaJson(schema);

                let cl = '';
                if (verDetail.has_changelog) {
                    cl = await fetchHelmChangelogMd(repoName, chartName);
                }
                if (!cancelled) setChangelogMd(cl);
            } catch (e: any) {
                if (!cancelled) setLoadError(String(e?.message ?? e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void run();
        return () => {
            cancelled = true;
        };
    }, [repoName, chartName, selectedVersion]);

    const hubUrl = useMemo(() => helmChartHubWebUrl(repoName, chartName), [repoName, chartName]);

    const versionOptions = useMemo(() => {
        const raw = detail?.available_versions ?? [];
        return [...raw].sort((a, b) => b.ts - a.ts);
    }, [detail?.available_versions]);

    const filteredValueLines = useMemo(() => {
        const lines = valuesYaml.split('\n');
        const q = valuesQuery.trim().toLowerCase();
        if (!q) return lines.map((line, i) => ({ line, i }));
        return lines
            .map((line, i) => ({ line, i }))
            .filter(({ line }) => line.toLowerCase().includes(q));
    }, [valuesYaml, valuesQuery]);

    const schemaText = useMemo(() => {
        if (schemaJson == null) return '';
        try {
            return JSON.stringify(schemaJson, null, 2);
        } catch {
            return String(schemaJson);
        }
    }, [schemaJson]);

    const filteredSchemaLines = useMemo(() => {
        const lines = schemaText.split('\n');
        const q = schemaQuery.trim().toLowerCase();
        if (!q) return lines.map((line, i) => ({ line, i }));
        return lines
            .map((line, i) => ({ line, i }))
            .filter(({ line }) => line.toLowerCase().includes(q));
    }, [schemaText, schemaQuery]);

    const copyValues = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(valuesYaml);
            showToast('values.yaml copied to clipboard', 'success');
        } catch {
            showToast('Could not copy to clipboard', 'error');
        }
    }, [showToast, valuesYaml]);

    const suggestedLocalRepoName = useMemo(() => {
        const base = repoName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        return base.replace(/^-+|-+$/g, '').slice(0, 40) || 'chart';
    }, [repoName]);

    const handleAddRepo = async () => {
        const url = detail?.repository?.url;
        if (!url) {
            showToast('No repository URL on this package.', 'error');
            return;
        }
        if (url.startsWith('oci://')) {
            showToast('OCI registries need registry login outside this flow.', 'info');
            return;
        }
        setAddingRepo(true);
        try {
            await window.k8s.helm.addRepo(suggestedLocalRepoName, url);
            showToast(`Added Helm repo "${suggestedLocalRepoName}"`, 'success');
        } catch (e: any) {
            showToast(String(e?.message ?? e), 'error');
        } finally {
            setAddingRepo(false);
        }
    };

    const installHint = useMemo(() => {
        if (!detail) return '';
        const v = detail.version;
        const local = suggestedLocalRepoName;
        return `helm repo add ${local} ${detail.repository.url}\nhelm install my-${chartName} ${local}/${chartName} --version ${v} --namespace <ns> --create-namespace`;
    }, [detail, chartName, suggestedLocalRepoName]);

    if (loadError && !detail) {
        return (
            <div className="max-w-2xl space-y-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                    <ArrowLeft size={16} /> Back to charts
                </button>
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm px-4 py-3">{loadError}</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 h-full min-h-0 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft size={16} /> Back to charts
                    </button>
                    <div className="flex flex-wrap items-baseline gap-3">
                        <h1 className="text-xl font-semibold text-white tracking-tight">{chartName}</h1>
                        {detail && (
                            <span className="text-gray-500">
                                {detail.repository.organization_display_name ||
                                    detail.repository.display_name ||
                                    repoName}
                            </span>
                        )}
                    </div>
                    {detail && (
                        <p className="text-gray-400 max-w-3xl line-clamp-2">{detail.description}</p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {detail && (
                        <>
                            <label className="text-xs text-gray-500 flex items-center gap-2">
                                Chart version
                                <select
                                    value={selectedVersion ?? detail.version}
                                    onChange={e => setSelectedVersion(e.target.value)}
                                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                                    disabled={loading}
                                >
                                    {(versionOptions.length > 0
                                        ? versionOptions
                                        : [{ version: detail.version, prerelease: false }]
                                    ).map(o => (
                                        <option key={o.version} value={o.version}>
                                            {o.version}
                                            {o.prerelease ? ' (prerelease)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <GlassButton
                                variant="secondary"
                                className="!text-xs !py-1.5 !px-2"
                                icon={<ExternalLink size={14} />}
                                onClick={() => window.k8s.openExternal(hubUrl)}
                            >
                                Artifact Hub
                            </GlassButton>
                            <GlassButton
                                variant="primary"
                                className="!text-xs !py-1.5 !px-2"
                                onClick={() => void handleAddRepo()}
                                disabled={addingRepo || !detail.repository?.url}
                                isLoading={addingRepo}
                            >
                                Add repo locally
                            </GlassButton>
                        </>
                    )}
                </div>
            </div>

            {loading && !detail && (
                <div className="flex items-center gap-2 text-gray-400">
                    <Loader2 size={18} className="animate-spin" /> Loading chart…
                </div>
            )}

            {detail && (
                <>
                    <div className="flex rounded-lg overflow-hidden border border-white/10 flex-wrap">
                        {(
                            [
                                ['overview', 'Overview', LayoutDashboard] as const,
                                ['readme', 'README', BookOpen] as const,
                                ['values', 'values.yaml', FileText] as const,
                                ...(detail.has_changelog ? [['changelog', 'Changelog', History] as const] : []),
                                ...(detail.has_values_schema
                                    ? [['schema', 'Values schema', FileJson] as const]
                                    : []),
                            ] as const
                        ).map(([id, label, Icon]) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setTab(id as DetailTab)}
                                className={`px-4 py-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                                    tab === id
                                        ? 'bg-blue-600/25 text-blue-300'
                                        : 'bg-white/[0.03] text-gray-400 hover:text-gray-200'
                                }`}
                            >
                                <Icon size={14} /> {label}
                            </button>
                        ))}
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-4">
                        {tab === 'overview' && (
                            <div className="space-y-6 max-w-5xl">
                                {loading && (
                                    <div className="flex items-center gap-2 text-gray-400 text-xs">
                                        <Loader2 size={14} className="animate-spin" /> Refreshing version…
                                    </div>
                                )}
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {[
                                        ['Chart version', detail.version],
                                        ['App version', detail.app_version ?? '—'],
                                        ['Kube version', detail.data?.kubeVersion ?? '—'],
                                        ['Type', detail.data?.type ?? '—'],
                                        ['License', detail.license ?? '—'],
                                        ['Signed', detail.signed ? 'Yes' : 'No'],
                                    ].map(([k, v]) => (
                                        <div key={String(k)} className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                                            <div className="text-[10px] uppercase tracking-wide text-gray-500">{k}</div>
                                            <div className="text-gray-200 font-mono text-xs mt-0.5 break-all">{v}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {detail.deprecated && (
                                        <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                                            Deprecated
                                        </span>
                                    )}
                                    {detail.prerelease && (
                                        <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">
                                            Prerelease
                                        </span>
                                    )}
                                    {detail.contains_security_updates && (
                                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300">
                                            Security updates in this lineage
                                        </span>
                                    )}
                                </div>
                                {detail.keywords && detail.keywords.length > 0 && (
                                    <div>
                                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                            Keywords
                                        </h3>
                                        <div className="flex flex-wrap gap-1.5">
                                            {detail.keywords.map(kw => (
                                                <span
                                                    key={kw}
                                                    className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10"
                                                >
                                                    {kw}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div>
                                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                        Repository
                                    </h3>
                                    <div className="font-mono text-xs text-gray-300 break-all">{detail.repository.url}</div>
                                    {detail.home_url && (
                                        <button
                                            type="button"
                                            className="text-blue-400 hover:underline text-xs mt-1"
                                            onClick={() => window.k8s.openExternal(detail.home_url!)}
                                        >
                                            {detail.home_url}
                                        </button>
                                    )}
                                </div>
                                {detail.links && detail.links.length > 0 && (
                                    <div>
                                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                            Links
                                        </h3>
                                        <ul className="space-y-1">
                                            {detail.links.map((l, i) => (
                                                <li key={i}>
                                                    <button
                                                        type="button"
                                                        className="text-blue-400 hover:underline text-xs"
                                                        onClick={() => window.k8s.openExternal(l.url)}
                                                    >
                                                        {l.name || l.url}
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {detail.data?.dependencies && detail.data.dependencies.length > 0 && (
                                    <div>
                                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                            Chart dependencies
                                        </h3>
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="text-left text-gray-500 border-b border-white/10">
                                                    <th className="py-2 pr-2">Name</th>
                                                    <th className="py-2 pr-2">Version</th>
                                                    <th className="py-2">Repository</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {detail.data.dependencies.map((d, i) => (
                                                    <tr key={i} className="border-b border-white/5 text-gray-300">
                                                        <td className="py-1.5 pr-2 font-medium">{d.name}</td>
                                                        <td className="py-1.5 pr-2 font-mono">{d.version}</td>
                                                        <td className="py-1.5 font-mono break-all text-gray-400">
                                                            {d.repository}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {detail.crds && detail.crds.length > 0 && (
                                    <div>
                                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                            Bundled CRDs
                                        </h3>
                                        <ul className="text-xs text-gray-400 space-y-1 max-h-48 overflow-y-auto">
                                            {detail.crds.map((c, i) => (
                                                <li key={i}>
                                                    <span className="text-gray-200">{c.kind}</span> {c.name}{' '}
                                                    <span className="font-mono text-gray-500">{c.version}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {detail.digest && (
                                    <div className="text-[10px] text-gray-500 font-mono break-all">
                                        Digest: {detail.digest}
                                    </div>
                                )}
                                <div>
                                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                        Example install (CLI)
                                    </h3>
                                    <pre className="text-xs font-mono bg-black/40 border border-white/10 rounded-lg p-3 overflow-x-auto text-gray-300 whitespace-pre-wrap">
                                        {installHint}
                                    </pre>
                                </div>
                            </div>
                        )}

                        {tab === 'readme' && (
                            <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-headings:text-gray-100 prose-headings:mt-4 prose-headings:mb-2 prose-ul:my-2 prose-li:my-0.5 prose-code:text-amber-200/90 prose-pre:bg-black/40">
                                {detail.readme ? (
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={HELM_MARKDOWN_COMPONENTS}>
                                        {detail.readme}
                                    </ReactMarkdown>
                                ) : (
                                    <p className="text-gray-500">No README published for this version on Artifact Hub.</p>
                                )}
                            </div>
                        )}

                        {tab === 'changelog' && detail.has_changelog && (
                            <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-headings:text-gray-100 prose-headings:mt-4 prose-headings:mb-2 prose-ul:my-2 prose-li:my-0.5 prose-code:text-amber-200/90 prose-pre:bg-black/40">
                                {loading && !changelogMd ? (
                                    <p className="text-gray-500 text-sm flex items-center gap-2">
                                        <Loader2 size={14} className="animate-spin" /> Loading changelog…
                                    </p>
                                ) : changelogMd ? (
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={HELM_MARKDOWN_COMPONENTS}>
                                        {changelogMd}
                                    </ReactMarkdown>
                                ) : (
                                    <p className="text-gray-500">Changelog is not available for this chart from Artifact Hub.</p>
                                )}
                            </div>
                        )}

                        {tab === 'values' && (
                            <div className="flex flex-col gap-3 h-full min-h-[320px]">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="relative flex-1 min-w-[200px] max-w-md">
                                        <Search
                                            size={14}
                                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
                                        />
                                        <input
                                            type="text"
                                            value={valuesQuery}
                                            onChange={e => setValuesQuery(e.target.value)}
                                            placeholder="Search keys, comments, values…"
                                            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                                        />
                                    </div>
                                    <GlassButton
                                        variant="secondary"
                                        className="!text-xs !py-1.5 !px-2"
                                        icon={<Clipboard size={14} />}
                                        onClick={() => void copyValues()}
                                        disabled={!valuesYaml}
                                    >
                                        Copy all
                                    </GlassButton>
                                    <span className="text-xs text-gray-500">
                                        {valuesQuery.trim()
                                            ? `${filteredValueLines.length} / ${valuesYaml.split('\n').length} lines`
                                            : `${valuesYaml.split('\n').length} lines`}
                                    </span>
                                </div>
                                {valuesError && (
                                    <div className="text-amber-400 text-xs">{valuesError}</div>
                                )}
                                {!valuesYaml && !valuesError && !loading && (
                                    <p className="text-gray-500 text-xs">
                                        Artifact Hub did not return a values.yaml for this version.
                                    </p>
                                )}
                                <pre className="flex-1 overflow-auto rounded-lg bg-black/50 border border-white/10 p-3 font-mono text-[11px] leading-relaxed text-gray-300">
                                    {filteredValueLines.map(({ line, i }) => (
                                        <div key={i} className="flex gap-2">
                                            <span className="w-9 shrink-0 text-right text-gray-600 select-none">
                                                {i + 1}
                                            </span>
                                            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                                                <HighlightMatches text={line} query={valuesQuery} />
                                            </span>
                                        </div>
                                    ))}
                                </pre>
                            </div>
                        )}

                        {tab === 'schema' && detail.has_values_schema && (
                            <div className="flex flex-col gap-3 min-h-[320px]">
                                <div className="relative flex-1 min-w-[200px] max-w-md">
                                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                                    <input
                                        type="text"
                                        value={schemaQuery}
                                        onChange={e => setSchemaQuery(e.target.value)}
                                        placeholder="Search schema JSON…"
                                        className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                                    />
                                </div>
                                {!schemaText && (
                                    <p className="text-gray-500 text-xs">No values.schema.json for this version.</p>
                                )}
                                <pre className="flex-1 overflow-auto rounded-lg bg-black/50 border border-white/10 p-3 font-mono text-[11px] leading-relaxed text-gray-300">
                                    {filteredSchemaLines.map(({ line, i }) => (
                                        <div key={i} className="flex gap-2">
                                            <span className="w-9 shrink-0 text-right text-gray-600 select-none">
                                                {i + 1}
                                            </span>
                                            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                                                <HighlightMatches text={line} query={schemaQuery} />
                                            </span>
                                        </div>
                                    ))}
                                </pre>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
