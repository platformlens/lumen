import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Package, RefreshCw, Library } from 'lucide-react';
import { GlassButton } from '../../shared/GlassButton';
import { loadHelmCatalog, artifactHubPackageUrl, type HelmCatalogSection } from '../../../lib/helm-catalog';
import type { ArtifactHubPackage } from '../../../lib/artifacthub';

type MainTab = 'catalog' | 'local';

const CATALOG_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') as readonly string[];

function chartSortKey(name: string): string {
    return name.trim().toLocaleLowerCase();
}

/** First bucket for catalog A–Z filter: A–Z or # (number, symbol, empty). */
function firstCatalogLetter(name: string): string {
    const c = name.trim().charAt(0);
    if (!c) return '#';
    const u = c.toUpperCase();
    if (u.length === 1 && u >= 'A' && u <= 'Z') return u;
    return '#';
}

function suggestedRepoLocalName(pkg: ArtifactHubPackage): string {
    const base = pkg.repository?.name?.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'chart';
    return base.replace(/^-+|-+$/g, '').slice(0, 40) || 'repo';
}

interface HelmChartsViewProps {
    searchQuery: string;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    onNavigate?: (view: string) => void;
}

export const HelmChartsView: React.FC<HelmChartsViewProps> = ({ searchQuery, showToast, onNavigate }) => {
    const [mainTab, setMainTab] = useState<MainTab>('catalog');
    const [catalog, setCatalog] = useState<HelmCatalogSection[] | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [catalogLoading, setCatalogLoading] = useState(false);

    const [repos, setRepos] = useState<Array<{ name: string; url: string }>>([]);
    const [reposLoading, setReposLoading] = useState(false);
    const [reposUpdating, setReposUpdating] = useState(false);

    const [addName, setAddName] = useState('');
    const [addUrl, setAddUrl] = useState('');
    const [addBusy, setAddBusy] = useState(false);
    const [catalogLetter, setCatalogLetter] = useState<string | null>(null);

    const q = searchQuery.trim().toLowerCase();

    /** After text search only; used for A–Z availability and final display pipeline. */
    const searchFilteredCatalog = useMemo(() => {
        if (!catalog) return null;
        if (!q) return catalog;
        return catalog
            .map(section => ({
                ...section,
                packages: section.packages.filter(p => {
                    const hay = `${p.name} ${p.description} ${p.repository?.organization_display_name ?? ''} ${p.repository?.url ?? ''}`.toLowerCase();
                    return hay.includes(q);
                }),
            }))
            .filter(s => s.packages.length > 0);
    }, [catalog, q]);

    const catalogLettersPresent = useMemo(() => {
        const set = new Set<string>();
        if (!searchFilteredCatalog) return set;
        for (const section of searchFilteredCatalog) {
            for (const p of section.packages) {
                set.add(firstCatalogLetter(p.name));
            }
        }
        return set;
    }, [searchFilteredCatalog]);

    const filteredCatalog = useMemo(() => {
        if (!searchFilteredCatalog) return null;
        return searchFilteredCatalog
            .map(section => {
                let packages = section.packages;
                if (catalogLetter) {
                    packages = packages.filter(p => firstCatalogLetter(p.name) === catalogLetter);
                }
                packages = [...packages].sort((a, b) =>
                    chartSortKey(a.name).localeCompare(chartSortKey(b.name), undefined, { sensitivity: 'base' })
                );
                return { ...section, packages };
            })
            .filter(s => s.packages.length > 0);
    }, [searchFilteredCatalog, catalogLetter]);

    const loadCatalog = useCallback(async (forceRefresh?: boolean) => {
        setCatalogLoading(true);
        setCatalogError(null);
        try {
            const sections = await loadHelmCatalog(forceRefresh ? { force: true } : undefined);
            setCatalog(sections);
        } catch (e: any) {
            setCatalogError(String(e?.message ?? e));
        } finally {
            setCatalogLoading(false);
        }
    }, []);

    const refreshRepos = useCallback(async () => {
        setReposLoading(true);
        try {
            const list = await window.k8s.helm.listRepos();
            setRepos(list);
        } catch (e: any) {
            showToast(String(e?.message ?? e), 'error');
        } finally {
            setReposLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        if (mainTab === 'catalog' && catalog === null && !catalogLoading && !catalogError) {
            void loadCatalog();
        }
    }, [mainTab, catalog, catalogLoading, catalogError, loadCatalog]);

    useEffect(() => {
        if (catalogLetter && !catalogLettersPresent.has(catalogLetter)) {
            setCatalogLetter(null);
        }
    }, [catalogLetter, catalogLettersPresent]);

    useEffect(() => {
        if (mainTab === 'local') {
            void refreshRepos();
        }
    }, [mainTab, refreshRepos]);

    const handleUpdateAllRepos = async () => {
        setReposUpdating(true);
        try {
            const msg = await window.k8s.helm.updateRepos();
            showToast(msg.slice(0, 200) || 'Helm repositories updated.', 'success');
            await refreshRepos();
        } catch (e: any) {
            showToast(String(e?.message ?? e), 'error');
        } finally {
            setReposUpdating(false);
        }
    };

    const handleAddRepo = async (name: string, url: string) => {
        if (!name.trim() || !url.trim()) {
            showToast('Name and URL are required.', 'error');
            return;
        }
        if (url.startsWith('oci://')) {
            showToast('OCI registries need `helm registry login` before install. Use HTTPS index URLs with Add repository.', 'info');
            return;
        }
        setAddBusy(true);
        try {
            await window.k8s.helm.addRepo(name.trim(), url.trim());
            showToast(`Added Helm repo "${name.trim()}"`, 'success');
            setAddName('');
            setAddUrl('');
            await refreshRepos();
        } catch (e: any) {
            showToast(String(e?.message ?? e), 'error');
        } finally {
            setAddBusy(false);
        }
    };

    const handleAddFromChart = (pkg: ArtifactHubPackage) => {
        setAddName(suggestedRepoLocalName(pkg));
        setAddUrl(pkg.repository.url);
        setMainTab('local');
        showToast('Review the repo name and URL, then click Add repository.', 'info');
    };

    const filteredRepos = useMemo(() => {
        if (!q) return repos;
        return repos.filter(r => r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q));
    }, [repos, q]);

    const openChartDetail = (pkg: ArtifactHubPackage) => {
        const path = `helm-chart-detail/${encodeURIComponent(pkg.repository.name)}/${encodeURIComponent(pkg.name)}`;
        onNavigate?.(path);
    };

    return (
        <div className="flex flex-col gap-6 h-full min-h-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-4">
                <div className="flex rounded-lg overflow-hidden border border-white/10">
                    <button
                        type="button"
                        onClick={() => setMainTab('catalog')}
                        className={`px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors ${mainTab === 'catalog' ? 'bg-blue-600/25 text-blue-300' : 'bg-white/[0.03] text-gray-400 hover:text-gray-200'}`}
                    >
                        <Package size={16} />
                        Catalog
                    </button>
                    <button
                        type="button"
                        onClick={() => setMainTab('local')}
                        className={`px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors ${mainTab === 'local' ? 'bg-blue-600/25 text-blue-300' : 'bg-white/[0.03] text-gray-400 hover:text-gray-200'}`}
                    >
                        <Library size={16} />
                        Local repos
                    </button>
                </div>
                <p className="text-xs text-gray-500 max-w-xl">
                    Click a chart for README, default values, and install hints. Data from{' '}
                    <button
                        type="button"
                        className="text-blue-400 hover:underline"
                        onClick={() => window.k8s.openExternal('https://artifacthub.io/')}
                    >
                        Artifact Hub
                    </button>
                    . Local repos use your machine&apos;s <code className="text-gray-400">helm</code> CLI config.
                </p>
            </div>

            {mainTab === 'catalog' && (
                <div className="flex-1 overflow-y-auto space-y-8 pr-1">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <GlassButton
                                variant="secondary"
                                icon={<RefreshCw size={16} className={catalogLoading ? 'animate-spin' : ''} />}
                                onClick={() => void loadCatalog(true)}
                                disabled={catalogLoading}
                            >
                                {catalogLoading ? 'Loading…' : 'Refresh catalog'}
                            </GlassButton>
                        </div>

                        {searchFilteredCatalog && searchFilteredCatalog.some(s => s.packages.length > 0) && (
                            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Filter by chart name</div>
                                <div className="flex flex-wrap gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => setCatalogLetter(null)}
                                        className={`min-w-[2rem] h-8 px-2 rounded-md text-xs font-medium border transition-colors ${
                                            catalogLetter === null
                                                ? 'bg-blue-600/35 border-blue-500/40 text-blue-200'
                                                : 'bg-white/[0.04] border-white/10 text-gray-400 hover:bg-white/[0.08] hover:text-gray-200'
                                        }`}
                                    >
                                        All
                                    </button>
                                    {CATALOG_LETTERS.map(letter => {
                                        const has = catalogLettersPresent.has(letter);
                                        const active = catalogLetter === letter;
                                        return (
                                            <button
                                                key={letter}
                                                type="button"
                                                disabled={!has}
                                                onClick={() => setCatalogLetter(active ? null : letter)}
                                                title={has ? `Charts starting with ${letter}` : 'No charts for this letter in the current list'}
                                                className={`w-8 h-8 rounded-md text-xs font-semibold border transition-colors ${
                                                    active
                                                        ? 'bg-blue-600/35 border-blue-500/40 text-blue-200'
                                                        : has
                                                          ? 'bg-white/[0.04] border-white/10 text-gray-300 hover:bg-white/[0.08] hover:text-white'
                                                          : 'bg-transparent border-white/[0.06] text-gray-600 cursor-not-allowed opacity-50'
                                                }`}
                                            >
                                                {letter}
                                            </button>
                                        );
                                    })}
                                    <button
                                        type="button"
                                        disabled={!catalogLettersPresent.has('#')}
                                        onClick={() => setCatalogLetter(catalogLetter === '#' ? null : '#')}
                                        title={
                                            catalogLettersPresent.has('#')
                                                ? 'Charts starting with a number or symbol'
                                                : 'No charts starting with non-letter in the current list'
                                        }
                                        className={`w-8 h-8 rounded-md text-xs font-semibold border transition-colors ${
                                            catalogLetter === '#'
                                                ? 'bg-blue-600/35 border-blue-500/40 text-blue-200'
                                                : catalogLettersPresent.has('#')
                                                  ? 'bg-white/[0.04] border-white/10 text-gray-300 hover:bg-white/[0.08] hover:text-white'
                                                  : 'bg-transparent border-white/[0.06] text-gray-600 cursor-not-allowed opacity-50'
                                        }`}
                                    >
                                        #
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {catalogError && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm px-4 py-3">
                            {catalogError}
                        </div>
                    )}

                    {catalogLoading && !catalog && <div className="text-gray-400 text-sm">Loading Artifact Hub…</div>}

                    {filteredCatalog?.map(section => (
                        <section key={section.id}>
                            <h2 className="text-lg font-semibold text-gray-100 mb-1">{section.title}</h2>
                            <p className="text-sm text-gray-500 mb-4">{section.description}</p>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {section.packages.map(pkg => (
                                    <div
                                        key={`${pkg.package_id}-${pkg.version}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => openChartDetail(pkg)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                openChartDetail(pkg);
                                            }
                                        }}
                                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-col gap-2 cursor-pointer hover:bg-white/[0.06] hover:border-white/15 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="font-medium text-gray-200 truncate">{pkg.name}</div>
                                                <div className="text-xs text-gray-500 truncate">
                                                    {pkg.repository.organization_display_name || pkg.repository.display_name || pkg.repository.name}
                                                </div>
                                            </div>
                                            {pkg.deprecated && (
                                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                                                    Deprecated
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-400 line-clamp-2">{pkg.description || 'No description.'}</p>
                                        <div className="text-xs text-gray-500 font-mono truncate" title={pkg.repository.url}>
                                            {pkg.repository.url}
                                        </div>
                                        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                                            <span>Chart {pkg.version}</span>
                                            {pkg.app_version && <span>App {pkg.app_version}</span>}
                                        </div>
                                        <div className="flex flex-wrap gap-2 mt-auto pt-2">
                                            <GlassButton
                                                variant="secondary"
                                                className="!px-2 !py-1 !text-xs"
                                                icon={<ExternalLink size={14} />}
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    window.k8s.openExternal(artifactHubPackageUrl(pkg));
                                                }}
                                            >
                                                Open in browser
                                            </GlassButton>
                                            <GlassButton
                                                variant="primary"
                                                className="!px-2 !py-1 !text-xs"
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    handleAddFromChart(pkg);
                                                }}
                                            >
                                                Add repo
                                            </GlassButton>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}

                    {filteredCatalog && filteredCatalog.every(s => s.packages.length === 0) && !catalogLoading && (
                        <p className="text-sm text-gray-500">No catalog entries match your search.</p>
                    )}
                </div>
            )}

            {mainTab === 'local' && (
                <div className="flex-1 flex flex-col gap-4 min-h-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <GlassButton
                            variant="secondary"
                            icon={<RefreshCw size={16} className={reposLoading ? 'animate-spin' : ''} />}
                            onClick={() => void refreshRepos()}
                            disabled={reposLoading}
                        >
                            Refresh list
                        </GlassButton>
                        <GlassButton variant="primary" icon={<RefreshCw size={16} className={reposUpdating ? 'animate-spin' : ''} />} onClick={() => void handleUpdateAllRepos()} disabled={reposUpdating}>
                            helm repo update
                        </GlassButton>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                        <div className="text-sm font-medium text-gray-200">Add repository</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <input
                                value={addName}
                                onChange={e => setAddName(e.target.value)}
                                placeholder="Local name (e.g. istio)"
                                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                            />
                            <input
                                value={addUrl}
                                onChange={e => setAddUrl(e.target.value)}
                                placeholder="Index URL (https://…)"
                                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                            />
                        </div>
                        <GlassButton variant="primary" onClick={() => void handleAddRepo(addName, addUrl)} disabled={addBusy} isLoading={addBusy}>
                            Add repository
                        </GlassButton>
                    </div>

                    <div className="flex-1 overflow-auto rounded-xl border border-white/10">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-950/95 backdrop-blur border-b border-white/10">
                                <tr className="text-left text-gray-400">
                                    <th className="px-4 py-3 font-medium">Name</th>
                                    <th className="px-4 py-3 font-medium">URL</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRepos.length === 0 && !reposLoading && (
                                    <tr>
                                        <td colSpan={2} className="px-4 py-8 text-center text-gray-500">
                                            No repositories configured. Add one above or from the Catalog tab.
                                        </td>
                                    </tr>
                                )}
                                {filteredRepos.map(r => (
                                    <tr key={r.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                                        <td className="px-4 py-2.5 font-mono text-gray-200">{r.name}</td>
                                        <td className="px-4 py-2.5 text-gray-400 font-mono text-xs break-all">{r.url}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
