import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CrossplaneSectionError } from '../../../../types/crossplane';

interface CrossplaneSectionErrorsProps {
    errors?: readonly CrossplaneSectionError[] | null;
    /** A query-level error (the whole call failed); previous data may still be shown. */
    queryError?: string | null;
}

/** Yellow warning card listing `section: message` for partial failures (e.g. 403 on one section). */
export const CrossplaneSectionErrors: React.FC<CrossplaneSectionErrorsProps> = ({ errors, queryError }) => {
    const list = errors ?? [];
    if (list.length === 0 && !queryError) return null;
    return (
        <div role="status" className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 p-3 text-sm flex gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
            <ul className="space-y-0.5 min-w-0">
                {queryError && <li className="break-words">{queryError}</li>}
                {list.map(e => (
                    <li key={`${e.section}|${e.status}`} className="break-words">
                        <span className="font-medium">{e.section}</span>: {e.message}
                    </li>
                ))}
            </ul>
        </div>
    );
};
