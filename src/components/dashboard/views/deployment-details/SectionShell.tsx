import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Lock, XCircle } from 'lucide-react';
import type { SectionResult } from '../../../../types/deployment-details';
import type { CheckLevel } from '../../../../utils/security-posture-utils';
import { STATUS_CLASSES, type StatusColor } from './status-classes';

interface SectionShellProps<T> {
    id: string;
    title: string;
    namespace: string;
    /** Omit for sections driven only by the deployment object. */
    result?: SectionResult<T>;
    /** e.g. "list services", "read nodes" */
    unavailableLabel?: string;
    /** 'cluster' for nodes / namespace reads. */
    scope?: 'namespace' | 'cluster';
    /** Optional controls rendered at the right of the header bar. */
    actions?: React.ReactNode;
    className?: string;
    children: React.ReactNode | ((data: T) => React.ReactNode);
}

/** Non-fatal caveat line (`SectionResult.note`). */
export const SectionNote = React.memo<{ children: React.ReactNode }>(({ children }) => (
    <p className="flex items-start gap-1.5 text-xs text-gray-400">
        <Info size={14} className="mt-px shrink-0" aria-hidden="true" />
        <span>{children}</span>
    </p>
));
SectionNote.displayName = 'SectionNote';

type UnavailableProps =
    | { kind: 'forbidden'; label: string; namespace: string; scope?: 'namespace' | 'cluster' }
    | { kind: 'error'; message: string };

/** Rendered in place of a section (or sub-list) whose data couldn't be read. */
export const SectionUnavailable = React.memo<UnavailableProps>((props) => {
    if (props.kind === 'forbidden') {
        const text = props.scope === 'cluster'
            ? `Not available: missing permission to ${props.label} (cluster-scoped)`
            : `Not available: missing permission to ${props.label} in ${props.namespace}`;
        return (
            <div className="flex items-start gap-2 text-sm text-gray-400 bg-white/5 border border-white/10 rounded-xl p-3">
                <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{text}</span>
            </div>
        );
    }
    return (
        <div className="flex items-start gap-2 text-sm text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="break-words min-w-0">{props.message}</span>
        </div>
    );
});
SectionUnavailable.displayName = 'SectionUnavailable';

const LEVEL_META: Record<CheckLevel, { color: StatusColor; Icon: typeof CheckCircle2; text: string }> = {
    pass: { color: 'green', Icon: CheckCircle2, text: 'Pass' },
    warn: { color: 'yellow', Icon: AlertTriangle, text: 'Warn' },
    fail: { color: 'red', Icon: XCircle, text: 'Fail' },
    info: { color: 'blue', Icon: Info, text: 'Info' },
};

/** Check level badge; always pairs an icon with text so status isn't colour-only. */
export const LevelBadge = React.memo<{ level: CheckLevel; label?: string; title?: string }>(({ level, label, title }) => {
    const { color, Icon, text } = LEVEL_META[level];
    return (
        <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASSES[color]}`}>
            <Icon size={12} aria-hidden="true" />
            {label ?? text}
        </span>
    );
});
LevelBadge.displayName = 'LevelBadge';

function SectionShellInner<T>({
    id, title, namespace, result, unavailableLabel = 'read this resource', scope = 'namespace', actions, className, children,
}: SectionShellProps<T>) {
    const titleId = `${id}-title`;

    let body: React.ReactNode;
    if (!result) {
        if (typeof children === 'function') {
            if (import.meta.env.DEV) console.error(`[SectionShell] "${id}": function children require a result`);
            body = null;
        } else {
            body = children;
        }
    } else if (result.status === 'ok') {
        body = (
            <>
                {result.note && <div className="mb-3"><SectionNote>{result.note}</SectionNote></div>}
                {typeof children === 'function' ? (children as (data: T) => React.ReactNode)(result.data) : children}
            </>
        );
    } else if (result.status === 'forbidden') {
        body = <SectionUnavailable kind="forbidden" label={unavailableLabel} namespace={namespace} scope={scope} />;
    } else {
        body = <SectionUnavailable kind="error" message={result.message} />;
    }

    return (
        <section id={id} aria-labelledby={titleId} className={`scroll-mt-24 ${className ?? ''}`}>
            <div className="flex items-center justify-between gap-3 mb-4">
                <h2 id={titleId} className="text-2xl font-bold text-white flex items-center gap-2">
                    <div className="w-1 h-8 bg-orange-500 rounded-full" aria-hidden="true"></div>
                    {title}
                </h2>
                {actions}
            </div>
            {body}
        </section>
    );
}

/** Section wrapper: anchor id, orange-bar header, and ok/forbidden/error handling for a SectionResult. */
export const SectionShell = React.memo(SectionShellInner) as typeof SectionShellInner;
