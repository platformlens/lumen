import React from 'react';
import type {
    ActivationPolicyRow, CompositeRow, CrossplaneCategory, CrossplaneCompositesPayload, CrossplaneDefinitionsPayload,
    CrossplaneObjectRef, CrossplaneRowBase, DrawerLink, PackageRow, ProviderConfigRow, RuntimeConfigRow, XrdRow,
} from '../../../types/crossplane';
import { CrossplaneHealthBadge } from '../../dashboard/views/crossplane/CrossplaneHealthBadge';
import {
    apiGroupOf, asArray, asNumber, asRecord, asString, getAnnotations, getPath, getResourceRefs, resolveXrdScope,
} from '../../../utils/crossplane-utils';
import { makeLink } from '../../../utils/crossplane-drawer-refs';

/** Snapshot extras for the drawer (design B.9 "Drawer data flow"). */
export interface CrossplaneDrawerExtras {
    /** false for categories whose sections derive only from the object. */
    needed: boolean;
    loading: boolean;
    error: string | null;
    /** The snapshot row matching crossplaneKey(object), when found. */
    row?: CrossplaneRowBase;
    definitions?: CrossplaneDefinitionsPayload | null;
    composites?: CrossplaneCompositesPayload | null;
}

interface CrossplaneDetailSectionsProps {
    category: CrossplaneCategory | null;
    object: unknown;
    links: DrawerLink[];
    extras: CrossplaneDrawerExtras;
    onOpenResource: (ref: CrossplaneObjectRef) => void;
}

type OpenFn = (ref: CrossplaneObjectRef) => void;

const MAX_LISTED = 25;

// ── Presentational helpers ──

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
        <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider">{title}</h3>
        {children}
    </section>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="grid grid-cols-[150px_1fr] gap-2 text-sm">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 min-w-0 break-words">{children}</span>
    </div>
);

const Dash = () => <span className="text-gray-500">—</span>;

function text(v: unknown): React.ReactNode {
    if (typeof v === 'string' && v !== '') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return <Dash />;
}

const LinkValue: React.FC<{ link: DrawerLink; onOpen: OpenFn }> = ({ link, onOpen }) => {
    const ref = link.ref;
    if (!ref) return <span className="font-mono text-xs text-gray-300 break-all">{link.text}</span>;
    return (
        <button
            type="button"
            onClick={() => onOpen(ref)}
            className="font-mono text-xs text-blue-400 hover:text-blue-300 hover:underline text-left break-all"
        >
            {link.text}
        </button>
    );
};

const LinkList: React.FC<{ links: DrawerLink[]; onOpen: OpenFn }> = ({ links, onOpen }) => {
    if (links.length === 0) return <Dash />;
    const shown = links.slice(0, MAX_LISTED);
    return (
        <span className="flex flex-col items-start gap-1">
            {shown.map((l, i) => <LinkValue key={`${l.text}-${i}`} link={l} onOpen={onOpen} />)}
            {links.length > shown.length && <span className="text-xs text-gray-500">+{links.length - shown.length} more</span>}
        </span>
    );
};

const byLabel = (links: DrawerLink[], label: string) => links.filter(l => l.label === label);

const PlainList: React.FC<{ items: string[] }> = ({ items }) => items.length === 0 ? <Dash /> : (
    <span className="flex flex-wrap gap-1">
        {items.map(i => <span key={i} className="font-mono text-xs bg-white/5 px-2 py-0.5 rounded-md">{i}</span>)}
    </span>
);

/** Renders snapshot-backed content: skeleton while loading, inline error, or "Not in the current snapshot". */
const ExtrasBlock: React.FC<{ extras: CrossplaneDrawerExtras; children: (row: CrossplaneRowBase) => React.ReactNode }> = ({ extras, children }) => {
    if (extras.loading && !extras.row) {
        return (
            <div className="space-y-2 animate-pulse" aria-label="Loading">
                <div className="h-4 bg-white/5 rounded w-2/3" />
                <div className="h-4 bg-white/5 rounded w-1/2" />
            </div>
        );
    }
    if (extras.error && !extras.row) return <p className="text-sm text-red-400 break-words">{extras.error}</p>;
    if (!extras.row) return <p className="text-sm text-gray-500"><Dash /> <span className="ml-1">Not in the current snapshot</span></p>;
    return <>{children(extras.row)}</>;
};

interface PipelineStep { step: string; fn?: string; }

function pipelineSteps(pipeline: unknown): PipelineStep[] {
    return asArray(pipeline).map((p, i) => ({
        step: asString(getPath(p, 'step')) ?? `#${i + 1}`,
        fn: asString(getPath(p, 'functionRef', 'name')),
    }));
}

const PipelineTable: React.FC<{ steps: PipelineStep[]; links: DrawerLink[]; onOpen: OpenFn }> = ({ steps, links, onOpen }) => {
    if (steps.length === 0) return <p className="text-sm text-gray-500">No pipeline steps</p>;
    const fnLinks = byLabel(links, 'Function');
    return (
        <table className="w-full text-sm">
            <thead><tr className="text-gray-400 text-xs text-left border-b border-white/10"><th className="py-1 font-medium">Step</th><th className="py-1 font-medium">Function</th></tr></thead>
            <tbody className="divide-y divide-white/5">
                {steps.map((s, i) => {
                    const link = fnLinks.find(l => l.ref?.name === s.fn);
                    return (
                        <tr key={`${s.step}-${i}`}>
                            <td className="py-1 text-gray-300 font-mono text-xs">{s.step}</td>
                            <td className="py-1">{link ? <LinkValue link={link} onOpen={onOpen} /> : text(s.fn)}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};

// ── Per-category sections (design AM-2 table) ──

const PackageSections: React.FC<{ category: 'provider' | 'function' | 'configuration' } & Omit<CrossplaneDetailSectionsProps, 'category'>> = ({ category, object, links, extras, onOpenResource }) => (
    <>
        <Section title="Package">
            <Field label="Package">{text(getPath(object, 'spec', 'package'))}</Field>
            <Field label="Pull policy">{text(getPath(object, 'spec', 'packagePullPolicy'))}</Field>
            <Field label="Activation policy">{text(getPath(object, 'spec', 'revisionActivationPolicy'))}</Field>
            <Field label="Current revision">{text(getPath(object, 'status', 'currentRevision'))}</Field>
            <Field label="Runtime config"><LinkList links={byLabel(links, 'Runtime config')} onOpen={onOpenResource} /></Field>
        </Section>
        <Section title="Revisions">
            <ExtrasBlock extras={extras}>{(r) => {
                const row = r as PackageRow;
                if (row.revisions.length === 0) return <p className="text-sm text-gray-500">No revisions</p>;
                return (
                    <table className="w-full text-sm">
                        <thead><tr className="text-gray-400 text-xs text-left border-b border-white/10">
                            <th className="py-1 font-medium">Name</th><th className="py-1 font-medium">Rev</th>
                            <th className="py-1 font-medium">State</th><th className="py-1 font-medium">Health</th>
                        </tr></thead>
                        <tbody className="divide-y divide-white/5">
                            {row.revisions.map(rev => (
                                <tr key={rev.key}>
                                    <td className="py-1"><LinkValue link={makeLink('Revision', rev, rev.name)} onOpen={onOpenResource} /></td>
                                    <td className="py-1 text-gray-300">{rev.revision}</td>
                                    <td className="py-1 text-gray-300">{rev.desiredState}</td>
                                    <td className="py-1"><CrossplaneHealthBadge health={rev.health} reason={rev.healthReason} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                );
            }}</ExtrasBlock>
        </Section>
        {category === 'provider' && (
            <Section title="Installed definitions">
                <ExtrasBlock extras={extras}>{(r) => <Field label="Count">{(r as PackageRow).installedDefinitionCount}</Field>}</ExtrasBlock>
            </Section>
        )}
        {category === 'function' && (
            <Section title="Used by compositions">
                <ExtrasBlock extras={extras}>{() => <LinkList links={byLabel(links, 'Used by')} onOpen={onOpenResource} />}</ExtrasBlock>
            </Section>
        )}
        {category === 'configuration' && (
            <Section title="Dependencies">
                <ExtrasBlock extras={extras}>{(r) => {
                    const row = r as PackageRow;
                    return <Field label="Installed">{row.depsInstalled} / {row.depsFound}</Field>;
                }}</ExtrasBlock>
            </Section>
        )}
    </>
);

const RevisionSections: React.FC<Omit<CrossplaneDetailSectionsProps, 'category'>> = ({ object, links, onOpenResource }) => (
    <Section title="Revision">
        <Field label="Package"><LinkList links={byLabel(links, 'Package')} onOpen={onOpenResource} /></Field>
        <Field label="Image">{text(getPath(object, 'spec', 'image'))}</Field>
        <Field label="Revision">{text(getPath(object, 'spec', 'revision'))}</Field>
        <Field label="Desired state">{text(getPath(object, 'spec', 'desiredState'))}</Field>
        <Field label="Object refs">{asArray(getPath(object, 'status', 'objectRefs')).length}</Field>
    </Section>
);

const ConfigSections: React.FC<{ category: 'runtimeConfig' | 'providerConfig' | 'activationPolicy' | 'environmentConfig' } & Omit<CrossplaneDetailSectionsProps, 'category'>> = ({ category, object, links, extras, onOpenResource }) => {
    if (category === 'runtimeConfig') {
        return (
            <Section title="Used by packages">
                <ExtrasBlock extras={extras}>{(r) => (
                    <>
                        <Field label="Count">{(r as RuntimeConfigRow).usedByCount}</Field>
                        <Field label="Packages"><LinkList links={byLabel(links, 'Used by')} onOpen={onOpenResource} /></Field>
                    </>
                )}</ExtrasBlock>
            </Section>
        );
    }
    if (category === 'providerConfig') {
        return (
            <Section title="Provider config">
                <Field label="Credentials source">{text(getPath(object, 'spec', 'credentials', 'source'))}</Field>
                <Field label="Credentials"><LinkList links={byLabel(links, 'Credentials')} onOpen={onOpenResource} /></Field>
                <Field label="Users">
                    <ExtrasBlock extras={extras}>{(r) => (r as ProviderConfigRow).userCount}</ExtrasBlock>
                </Field>
            </Section>
        );
    }
    if (category === 'activationPolicy') {
        const patterns = asArray(getPath(object, 'spec', 'activate')).map(asString).filter((p): p is string => !!p);
        return (
            <Section title="Activation policy">
                <Field label="Patterns"><PlainList items={patterns} /></Field>
                <Field label="Activated">
                    <ExtrasBlock extras={extras}>{(r) => (r as ActivationPolicyRow).activatedCount}</ExtrasBlock>
                </Field>
            </Section>
        );
    }
    // environmentConfig: data keys only, values are never rendered.
    return (
        <Section title="Data keys">
            <PlainList items={Object.keys(asRecord(getPath(object, 'data')) ?? {}).sort()} />
        </Section>
    );
};

function compositesOf(xrd: XrdRow, composites: CrossplaneCompositesPayload | null | undefined): CompositeRow[] {
    return (composites?.composites ?? []).filter(c => c.kind === xrd.xrKind && apiGroupOf(c.apiVersion) === xrd.group);
}

const XrdSections: React.FC<Omit<CrossplaneDetailSectionsProps, 'category'>> = ({ object, links, extras, onOpenResource }) => {
    const versions = asArray(getPath(object, 'spec', 'versions'));
    return (
        <>
            <Section title="Definition">
                <Field label="Group">{text(getPath(object, 'spec', 'group'))}</Field>
                <Field label="Kind / plural">{text(getPath(object, 'spec', 'names', 'kind'))} / {text(getPath(object, 'spec', 'names', 'plural'))}</Field>
                <Field label="Claim names">{getPath(object, 'spec', 'claimNames', 'kind')
                    ? <>{text(getPath(object, 'spec', 'claimNames', 'kind'))} / {text(getPath(object, 'spec', 'claimNames', 'plural'))}</>
                    : <Dash />}</Field>
                <Field label="Scope">{resolveXrdScope(object)}</Field>
                <Field label="Default composition"><LinkList links={byLabel(links, 'Default composition')} onOpen={onOpenResource} /></Field>
                {byLabel(links, 'Enforced composition').length > 0 && (
                    <Field label="Enforced composition"><LinkList links={byLabel(links, 'Enforced composition')} onOpen={onOpenResource} /></Field>
                )}
            </Section>
            <Section title="Versions">
                {versions.length === 0 ? <Dash /> : (
                    <table className="w-full text-sm">
                        <thead><tr className="text-gray-400 text-xs text-left border-b border-white/10">
                            <th className="py-1 font-medium">Name</th><th className="py-1 font-medium">Served</th><th className="py-1 font-medium">Referenceable</th>
                        </tr></thead>
                        <tbody className="divide-y divide-white/5">
                            {versions.map((v, i) => (
                                <tr key={asString(getPath(v, 'name')) ?? i}>
                                    <td className="py-1 font-mono text-xs text-gray-300">{text(getPath(v, 'name'))}</td>
                                    <td className="py-1 text-gray-300">{getPath(v, 'served') === true ? 'Yes' : 'No'}</td>
                                    <td className="py-1 text-gray-300">{getPath(v, 'referenceable') === true ? 'Yes' : 'No'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>
            <Section title="Compositions and instances">
                <ExtrasBlock extras={extras}>{(r) => (
                    <>
                        <Field label="Compositions"><LinkList links={byLabel(links, 'Composition')} onOpen={onOpenResource} /></Field>
                        <Field label="Instances">{extras.composites ? compositesOf(r as XrdRow, extras.composites).length : <Dash />}</Field>
                    </>
                )}</ExtrasBlock>
            </Section>
        </>
    );
};

const CompositionSections: React.FC<{ category: 'composition' | 'compositionRevision' } & Omit<CrossplaneDetailSectionsProps, 'category'>> = ({ category, object, links, extras, onOpenResource }) => {
    const pipeline = getPath(object, 'spec', 'pipeline');
    const mode = asString(getPath(object, 'spec', 'mode')) ?? (pipeline ? 'Pipeline' : 'Resources');
    const name = asString(getPath(object, 'metadata', 'name'));
    const xrs = (extras.composites?.composites ?? []).filter(c => c.compositionName === name);
    return (
        <>
            <Section title="Composition">
                <Field label="Composite type"><LinkList links={byLabel(links, 'Composite type')} onOpen={onOpenResource} /></Field>
                <Field label="Mode">{mode}</Field>
                {category === 'compositionRevision' && (
                    <>
                        <Field label="Composition"><LinkList links={byLabel(links, 'Composition')} onOpen={onOpenResource} /></Field>
                        <Field label="Revision">{text(getPath(object, 'spec', 'revision'))}</Field>
                    </>
                )}
            </Section>
            <Section title="Pipeline">
                <PipelineTable steps={pipelineSteps(pipeline)} links={links} onOpen={onOpenResource} />
            </Section>
            {category === 'composition' && (
                <Section title="Revisions and usage">
                    <ExtrasBlock extras={extras}>{() => (
                        <>
                            <Field label="Revisions"><LinkList links={byLabel(links, 'Revision')} onOpen={onOpenResource} /></Field>
                            <Field label="Used by XRs">
                                {extras.composites ? <LinkList links={xrs.map(x => makeLink('XR', x))} onOpen={onOpenResource} /> : <Dash />}
                            </Field>
                        </>
                    )}</ExtrasBlock>
                </Section>
            )}
        </>
    );
};

const CompositeSections: React.FC<{ category: 'composite' | 'claim' } & Omit<CrossplaneDetailSectionsProps, 'category'>> = ({ category, object, links, onOpenResource }) => {
    const policy = getPath(object, 'spec', 'crossplane', 'compositionUpdatePolicy') ?? getPath(object, 'spec', 'compositionUpdatePolicy');
    return (
        <Section title={category === 'claim' ? 'Claim' : 'Composite resource'}>
            <Field label="Composition"><LinkList links={byLabel(links, 'Composition')} onOpen={onOpenResource} /></Field>
            <Field label="Revision"><LinkList links={byLabel(links, 'Composition revision')} onOpen={onOpenResource} /></Field>
            <Field label="Update policy">{text(policy)}</Field>
            {category === 'claim'
                ? <Field label="Composite"><LinkList links={byLabel(links, 'Composite')} onOpen={onOpenResource} /></Field>
                : <Field label="Claim"><LinkList links={byLabel(links, 'Claim')} onOpen={onOpenResource} /></Field>}
            <Field label="Connection secret"><LinkList links={byLabel(links, 'Connection secret')} onOpen={onOpenResource} /></Field>
            {category === 'composite' && <Field label="Composed resources">{getResourceRefs(object).length}</Field>}
        </Section>
    );
};

const ManagedSections: React.FC<Omit<CrossplaneDetailSectionsProps, 'category'>> = ({ object, links, onOpenResource }) => {
    const policies = asArray(getPath(object, 'spec', 'managementPolicies')).map(asString).filter((p): p is string => !!p);
    return (
        <Section title="Managed resource">
            <Field label="External name"><span className="font-mono text-xs">{text(getAnnotations(object)['crossplane.io/external-name'])}</span></Field>
            <Field label="Provider config"><LinkList links={byLabel(links, 'Provider config')} onOpen={onOpenResource} /></Field>
            <Field label="Management policies"><PlainList items={policies} /></Field>
            <Field label="Deletion policy">{text(getPath(object, 'spec', 'deletionPolicy'))}</Field>
            <Field label="Composite"><LinkList links={byLabel(links, 'Composite')} onOpen={onOpenResource} /></Field>
            <Field label="Connection secret"><LinkList links={byLabel(links, 'Connection secret')} onOpen={onOpenResource} /></Field>
        </Section>
    );
};

const UsageSections: React.FC<Omit<CrossplaneDetailSectionsProps, 'category'>> = ({ object, links, onOpenResource }) => (
    <Section title="Usage">
        <Field label="Of"><LinkList links={byLabel(links, 'Of')} onOpen={onOpenResource} /></Field>
        <Field label="By"><LinkList links={byLabel(links, 'By')} onOpen={onOpenResource} /></Field>
        <Field label="Reason">{text(getPath(object, 'spec', 'reason'))}</Field>
        <Field label="Replay deletion">{text(getPath(object, 'spec', 'replayDeletion'))}</Field>
    </Section>
);

const OperationSections: React.FC<Omit<CrossplaneDetailSectionsProps, 'category'>> = ({ object, links, onOpenResource }) => {
    const kind = asString(getPath(object, 'kind'));
    const pipeline = kind === 'Operation' ? getPath(object, 'spec', 'pipeline') : getPath(object, 'spec', 'operationTemplate', 'spec', 'pipeline');
    return (
        <>
            {kind === 'CronOperation' && (
                <Section title="Schedule">
                    <Field label="Schedule"><span className="font-mono text-xs">{text(getPath(object, 'spec', 'schedule'))}</span></Field>
                    <Field label="Running"><LinkList links={byLabel(links, 'Running operation')} onOpen={onOpenResource} /></Field>
                </Section>
            )}
            {kind === 'WatchOperation' && (
                <Section title="Watch">
                    <Field label="Watched kind">{text(getPath(object, 'spec', 'watch', 'kind'))} ({text(getPath(object, 'spec', 'watch', 'apiVersion'))})</Field>
                    <Field label="Watching">{text(asNumber(getPath(object, 'status', 'watchingResources')))}</Field>
                    <Field label="Running"><LinkList links={byLabel(links, 'Running operation')} onOpen={onOpenResource} /></Field>
                </Section>
            )}
            <Section title="Pipeline">
                <PipelineTable steps={pipelineSteps(pipeline)} links={links} onOpen={onOpenResource} />
            </Section>
        </>
    );
};

/** Category-specific drawer sections. A null category renders nothing (generic sections only, AM-1). */
export const CrossplaneDetailSections: React.FC<CrossplaneDetailSectionsProps> = (props) => {
    const { category, ...rest } = props;
    switch (category) {
        case 'provider': case 'function': case 'configuration':
            return <PackageSections category={category} {...rest} />;
        case 'packageRevision': return <RevisionSections {...rest} />;
        case 'runtimeConfig': case 'providerConfig': case 'activationPolicy': case 'environmentConfig':
            return <ConfigSections category={category} {...rest} />;
        case 'xrd': return <XrdSections {...rest} />;
        case 'composition': case 'compositionRevision':
            return <CompositionSections category={category} {...rest} />;
        case 'composite': case 'claim':
            return <CompositeSections category={category} {...rest} />;
        case 'managed': return <ManagedSections {...rest} />;
        case 'usage': return <UsageSections {...rest} />;
        case 'operation': return <OperationSections {...rest} />;
        default: return null;
    }
};
