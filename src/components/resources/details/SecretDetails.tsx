import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Eye, EyeOff, Copy, Check, Shield, Calendar, Key, Tag, List, Edit } from 'lucide-react';

interface SecretDetailsProps {
    secret: any;
    explanation?: string | null;
    onExplain?: () => void;
    isExplaining?: boolean;
    onOpenYaml?: () => void;
}

interface DecodedCert {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    serialNumber: string;
    fingerprint: string;
    sans: string[];
}

export const SecretDetails: React.FC<SecretDetailsProps> = ({
    secret,
    explanation,
    onExplain,
    isExplaining,
    onOpenYaml
}) => {
    const [hiddenKeys, setHiddenKeys] = useState<Record<string, boolean>>({});
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [certScroll, setCertScroll] = useState<DecodedCert | null>(null);

    useEffect(() => {
        if (secret.data) {
            const initialHiddenState: Record<string, boolean> = {};
            Object.keys(secret.data).forEach(key => {
                initialHiddenState[key] = true;
            });
            setHiddenKeys(initialHiddenState);
        }
    }, [secret]);

    useEffect(() => {
        const loadCert = async () => {
            if (secret.type === 'kubernetes.io/tls' && secret.data?.['tls.crt']) {
                try {
                    // Pass raw base64 to main process — let Node.js Buffer handle decoding
                    const info = await window.k8s.decodeCertificate(secret.data['tls.crt']);
                    setCertScroll(info);
                } catch (e) {
                    console.error("Failed to decode cert", e);
                }
            }
        };
        loadCert();
    }, [secret]);

    const toggleKeyVisibility = (key: string) => {
        setHiddenKeys(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const copyToClipboard = (text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
    };

    const decodeValue = (value: string) => {
        try {
            return atob(value);
        } catch (e) {
            return "Failed to decode base64";
        }
    };

    if (!secret) return null;

    const { metadata } = secret;
    const isTls = secret.type === 'kubernetes.io/tls';

    return (
        <div className="space-y-8 text-sm">
            {/* AI Explanation */}
            {explanation && (
                <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-lg p-4 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-purple-500"></div>
                    <h3 className="text-blue-400 font-bold text-sm mb-2 flex items-center gap-2">
                        <span className="text-lg">✨</span> AI Explanation
                    </h3>
                    <div className="text-gray-200 leading-relaxed font-sans text-sm prose prose-invert max-w-none prose-p:my-1 prose-headings:text-blue-300 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1 prose-li:my-0">
                        <ReactMarkdown>{explanation}</ReactMarkdown>
                    </div>
                </div>
            )}

            {/* Metadata */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider">Metadata</h3>
                    <div className="flex items-center gap-2">
                        {onOpenYaml && (
                            <button
                                onClick={onOpenYaml}
                                className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all duration-300 border bg-gradient-to-r from-green-600/80 to-emerald-600/80 hover:from-green-500 hover:to-emerald-500 text-white border-transparent hover:shadow-lg hover:scale-105 active:scale-95"
                            >
                                <Edit size={12} /> Edit YAML
                            </button>
                        )}
                        {onExplain && (
                            <button
                                onClick={onExplain}
                                disabled={isExplaining}
                                className={`
                                    flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider
                                    transition-all duration-300 border
                                    ${isExplaining
                                        ? 'bg-purple-500/10 border-purple-500/20 text-purple-400 cursor-wait'
                                        : 'bg-gradient-to-r from-blue-600/80 to-purple-600/80 hover:from-blue-500 hover:to-purple-500 text-white border-transparent hover:shadow-lg hover:scale-105 active:scale-95'
                                    }
                                `}
                            >
                                {isExplaining ? (
                                    <>
                                        <div className="w-2 h-2 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Analyzing...
                                    </>
                                ) : (
                                    <>
                                        <span className="text-xs">✨</span> Explain
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>
                <div className="bg-white/5 rounded-md p-4 border border-white/10 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Name</span>
                        <span className="col-span-2 text-white font-mono">{metadata?.name}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Namespace</span>
                        <span className="col-span-2 text-white font-mono">{metadata?.namespace}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Type</span>
                        <span className="col-span-2 text-white font-mono">{secret.type}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">Created</span>
                        <span className="col-span-2 text-white">{metadata?.creationTimestamp ? new Date(metadata.creationTimestamp).toLocaleString() : '-'}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <span className="text-gray-400">UID</span>
                        <span className="col-span-2 text-gray-500 font-mono text-xs">{metadata?.uid}</span>
                    </div>
                </div>
            </div>

            {/* Labels & Annotations */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Tag size={14} /> Labels
                </h3>
                <div className="flex flex-wrap gap-2 mb-6">
                    {metadata?.labels ? Object.entries(metadata.labels).map(([k, v]) => (
                        <div key={k} className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded text-xs border border-blue-500/20 font-mono">
                            {k}: {String(v)}
                        </div>
                    )) : <span className="text-gray-500 italic">No labels</span>}
                </div>

                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <List size={14} /> Annotations
                </h3>
                <div className="space-y-1">
                    {metadata?.annotations ? Object.entries(metadata.annotations).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-1 gap-1 border-b border-white/10 pb-2 mb-2 last:border-0">
                            <span className="text-gray-400 font-mono text-xs">{k}</span>
                            <span className="text-gray-300 break-all">{String(v)}</span>
                        </div>
                    )) : <span className="text-gray-500 italic">No annotations</span>}
                </div>
            </div>

            {/* TLS Certificate Information */}
            {isTls && certScroll && (
                <div>
                    <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                        <Shield size={14} /> Certificate Information
                    </h3>
                    <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="bg-white/5 rounded-md p-3 border border-white/10">
                                <div className="text-gray-500 text-xs uppercase font-bold mb-2">Subject</div>
                                <div className="text-sm text-gray-300 break-all pl-2 border-l-2 border-blue-500/30">
                                    {certScroll.subject ? (
                                        certScroll.subject.split('\n').map((line, i) => <div key={i}>{line}</div>)
                                    ) : (
                                        <div className="text-gray-500 italic">No subject info</div>
                                    )}
                                </div>
                            </div>
                            <div className="bg-white/5 rounded-md p-3 border border-white/10">
                                <div className="text-gray-500 text-xs uppercase font-bold mb-2">Issuer</div>
                                <div className="text-sm text-gray-300 break-all pl-2 border-l-2 border-purple-500/30">
                                    {certScroll.issuer ? (
                                        certScroll.issuer.split('\n').map((line, i) => <div key={i}>{line}</div>)
                                    ) : (
                                        <div className="text-gray-500 italic">No issuer info</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white/5 rounded-md p-3 border border-white/10">
                            <div className="text-gray-500 text-xs uppercase font-bold mb-3">Validity Period</div>
                            <div className="flex items-center gap-6">
                                <div>
                                    <div className="text-gray-500 text-xs mb-1">Valid From</div>
                                    <div className="flex items-center gap-2 text-sm text-gray-300">
                                        <Calendar className="w-3 h-3 text-gray-500" />
                                        {new Date(certScroll.validFrom).toLocaleString()}
                                    </div>
                                </div>
                                <div className="h-8 w-px bg-white/10" />
                                <div>
                                    <div className="text-gray-500 text-xs mb-1">Expires On</div>
                                    <div className={`flex items-center gap-2 text-sm ${new Date(certScroll.validTo) < new Date() ? 'text-red-400' : 'text-green-400'}`}>
                                        <Calendar className="w-3 h-3 text-current" />
                                        {new Date(certScroll.validTo).toLocaleString()}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {certScroll.sans && certScroll.sans.length > 0 && (
                            <div className="bg-white/5 rounded-md p-3 border border-white/10">
                                <div className="text-gray-500 text-xs uppercase font-bold mb-2">SANs (Subject Alternative Names)</div>
                                <div className="flex flex-wrap gap-2">
                                    {certScroll.sans.map((san, i) => (
                                        <span key={i} className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded text-xs border border-blue-500/20">
                                            {san}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Secret Data */}
            <div>
                <h3 className="text-gray-500 uppercase font-bold text-xs tracking-wider mb-3 flex items-center gap-2">
                    <Key size={14} /> Data
                    <span className="text-gray-500 font-normal ml-auto">
                        {Object.keys(secret.data || {}).length} keys
                    </span>
                </h3>

                <div className="space-y-2">
                    {secret.data && Object.keys(secret.data).map(key => {
                        const isHidden = hiddenKeys[key];
                        const rawValue = secret.data[key];
                        const displayValue = isHidden ? '••••••••' : decodeValue(rawValue);
                        const isTlsKey = key === 'tls.key';

                        return (
                            <div key={key} className="bg-white/5 border border-white/10 rounded-md overflow-hidden group hover:border-white/15 transition-colors">
                                <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                                    <span className="font-mono text-xs text-blue-400">{key}</span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => copyToClipboard(decodeValue(rawValue), key)}
                                            className="p-1.5 hover:bg-white/10 rounded transition-colors text-gray-500 hover:text-gray-300"
                                            title="Copy value"
                                        >
                                            {copiedKey === key ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                                        </button>
                                        <button
                                            onClick={() => toggleKeyVisibility(key)}
                                            className="p-1.5 hover:bg-white/10 rounded transition-colors text-gray-500 hover:text-gray-300"
                                            title={isHidden ? "Show value" : "Hide value"}
                                        >
                                            {isHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                                        </button>
                                    </div>
                                </div>
                                <div className="p-3">
                                    {isTlsKey && !isHidden ? (
                                        <div className="text-xs font-mono text-red-300 whitespace-pre-wrap break-all bg-red-500/10 p-2 rounded border border-red-500/20">
                                            {displayValue}
                                        </div>
                                    ) : (
                                        <div className="text-xs font-mono text-gray-400 whitespace-pre-wrap break-all">
                                            {displayValue}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
