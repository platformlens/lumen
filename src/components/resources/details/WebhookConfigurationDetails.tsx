import React from 'react';
import { Shield, AlertTriangle, Clock, Filter } from 'lucide-react';
import { TimeAgo } from '../../shared/TimeAgo';

interface WebhookConfigurationDetailsProps {
    resource: any;
    onExplain?: () => void;
    onOpenYaml?: () => void;
}

export const WebhookConfigurationDetails: React.FC<WebhookConfigurationDetailsProps> = ({ resource, onExplain: _onExplain, onOpenYaml: _onOpenYaml }) => {
    if (!resource) return null;

    const metadata = resource.metadata || {};
    const webhooks: any[] = resource.webhooks || [];
    const isMutating = resource.kind === 'MutatingWebhookConfiguration';

    return (
        <div className="space-y-6 text-sm">
            {/* Metadata */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Metadata</h3>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">API Version</div>
                        <div className="col-span-2 text-white font-mono text-sm">{resource.apiVersion}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Kind</div>
                        <div className="col-span-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                                isMutating
                                    ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                    : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            }`}>
                                {isMutating ? 'Mutating' : 'Validating'}
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-gray-400">Created</div>
                        <div className="col-span-2 text-white text-sm">
                            {metadata.creationTimestamp ? <TimeAgo timestamp={metadata.creationTimestamp} /> : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Webhooks */}
            {webhooks.map((webhook: any, idx: number) => {
                const clientConfig = webhook.clientConfig || {};
                const service = clientConfig.service || {};
                const rules: any[] = webhook.rules || [];
                const admissionVersions: string[] = webhook.admissionReviewVersions || [];
                const objectSelector = webhook.objectSelector || {};
                const matchExpressions: any[] = objectSelector.matchExpressions || [];

                return (
                    <div key={idx}>
                        <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                            <Shield size={14} className="text-blue-400" />
                            {webhook.name || `Webhook ${idx + 1}`}
                        </h3>
                        <div className="bg-white/5 rounded-md border border-white/10 overflow-hidden">
                            {/* Service Info */}
                            {Object.keys(service).length > 0 && (
                                <div className="p-4 space-y-2 border-b border-white/10">
                                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Service</div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="text-gray-400">Name</div>
                                        <div className="col-span-2 text-white font-mono text-sm">{service.name}</div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="text-gray-400">Namespace</div>
                                        <div className="col-span-2 text-white font-mono text-sm">{service.namespace}</div>
                                    </div>
                                    {service.path && (
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="text-gray-400">Path</div>
                                            <div className="col-span-2 text-white font-mono text-sm">{service.path}</div>
                                        </div>
                                    )}
                                    {service.port && (
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="text-gray-400">Port</div>
                                            <div className="col-span-2 font-mono text-yellow-400">{service.port}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Policies */}
                            <div className="p-4 space-y-2 border-b border-white/10">
                                <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Policies</div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="text-gray-400">Failure Policy</div>
                                    <div className="col-span-2">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                                            webhook.failurePolicy === 'Fail'
                                                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                                : 'bg-green-500/10 text-green-400 border-green-500/20'
                                        }`}>
                                            {webhook.failurePolicy || '-'}
                                        </span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="text-gray-400">Match Policy</div>
                                    <div className="col-span-2">
                                        <span className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                            {webhook.matchPolicy || '-'}
                                        </span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="text-gray-400">Side Effects</div>
                                    <div className="col-span-2 text-white text-sm">{webhook.sideEffects || '-'}</div>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="text-gray-400 flex items-center gap-1">
                                        <Clock size={12} />
                                        Timeout
                                    </div>
                                    <div className="col-span-2 text-white font-mono text-sm">{webhook.timeoutSeconds != null ? `${webhook.timeoutSeconds}s` : '-'}</div>
                                </div>
                                {isMutating && webhook.reinvocationPolicy && (
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="text-gray-400">Reinvocation Policy</div>
                                        <div className="col-span-2 text-white text-sm">{webhook.reinvocationPolicy}</div>
                                    </div>
                                )}
                            </div>

                            {/* Admission Review Versions */}
                            {admissionVersions.length > 0 && (
                                <div className="p-4 space-y-2 border-b border-white/10">
                                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Admission Review Versions</div>
                                    <div className="flex flex-wrap gap-2">
                                        {admissionVersions.map((v: string) => (
                                            <span key={v} className="px-2 py-0.5 rounded text-xs font-medium border bg-blue-500/10 text-blue-400 border-blue-500/20">
                                                {v}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Rules */}
                            {rules.length > 0 && (
                                <div className="p-4 border-b border-white/10">
                                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <AlertTriangle size={14} />
                                        Rules ({rules.length})
                                    </div>
                                    <div className="bg-black/40 rounded border border-white/10 overflow-hidden">
                                        <table className="w-full text-xs font-mono">
                                            <thead>
                                                <tr className="border-b border-white/10">
                                                    <th className="px-2 py-1.5 text-left text-gray-400 font-medium">API Groups</th>
                                                    <th className="px-2 py-1.5 text-left text-gray-400 font-medium">Versions</th>
                                                    <th className="px-2 py-1.5 text-left text-gray-400 font-medium">Operations</th>
                                                    <th className="px-2 py-1.5 text-left text-gray-400 font-medium">Resources</th>
                                                    <th className="px-2 py-1.5 text-left text-gray-400 font-medium">Scope</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rules.map((rule: any, rIdx: number) => (
                                                    <tr key={rIdx} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                                                        <td className="px-2 py-1.5 text-blue-400">{(rule.apiGroups || []).join(', ') || '*'}</td>
                                                        <td className="px-2 py-1.5 text-white">{(rule.apiVersions || []).join(', ')}</td>
                                                        <td className="px-2 py-1.5 text-yellow-400">{(rule.operations || []).join(', ')}</td>
                                                        <td className="px-2 py-1.5 text-green-400">{(rule.resources || []).join(', ')}</td>
                                                        <td className="px-2 py-1.5 text-gray-300">{rule.scope || '*'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Object Selector */}
                            {matchExpressions.length > 0 && (
                                <div className="p-4">
                                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <Filter size={14} />
                                        Object Selector
                                    </div>
                                    <div className="bg-black/40 rounded border border-white/10 overflow-hidden">
                                        <table className="w-full text-xs font-mono">
                                            <thead>
                                                <tr className="border-b border-white/10">
                                                    <th className="px-2 py-1.5 text-left text-gray-400 font-medium">Key</th>
                                                    <th className="px-2 py-1.5 text-left text-gray-400 font-medium">Operator</th>
                                                    <th className="px-2 py-1.5 text-left text-gray-400 font-medium">Values</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {matchExpressions.map((expr: any, eIdx: number) => (
                                                    <tr key={eIdx} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                                                        <td className="px-2 py-1.5 text-blue-400">{expr.key}</td>
                                                        <td className="px-2 py-1.5 text-yellow-400">{expr.operator}</td>
                                                        <td className="px-2 py-1.5 text-white">{(expr.values || []).join(', ') || '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}

            {webhooks.length === 0 && (
                <div className="bg-white/5 rounded-md p-4 border border-white/10 text-center text-gray-500">
                    No webhooks defined
                </div>
            )}

            {/* Labels */}
            {metadata.labels && Object.keys(metadata.labels).length > 0 && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3">Labels</h3>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(metadata.labels).map(([k, v]) => (
                            <span key={k} className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400 font-mono">
                                {k}: {String(v)}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
