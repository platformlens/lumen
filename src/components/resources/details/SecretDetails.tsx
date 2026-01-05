import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Copy, Check, Lock, Shield, FileText, Calendar, Key } from 'lucide-react';

interface SecretDetailsProps {
    secret: any;
    explanation?: string | null;
    onExplain?: () => void;
    isExplaining?: boolean;
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
    isExplaining
}) => {
    const [hiddenKeys, setHiddenKeys] = useState<Record<string, boolean>>({});
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [certScroll, setCertScroll] = useState<DecodedCert | null>(null);

    // Initialize all keys as hidden
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
                    // Fix base64 padding/newlines if needed before sending? 
                    // Usually node's crypto handles standard PEM. 
                    // K8s data is base64 encoded PEM.
                    const b64 = secret.data['tls.crt'];
                    const pem = atob(b64);
                    const info = await window.k8s.decodeCertificate(pem);
                    setCertScroll(info);
                } catch (e) {
                    console.error("Failed to decode cert", e);
                }
            }
        };
        loadCert();
    }, [secret]);


    const toggleKeyVisibility = (key: string) => {
        setHiddenKeys(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
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

    const isTls = secret.type === 'kubernetes.io/tls';

    return (
        <div className="flex flex-col h-full bg-[#111111] text-gray-300">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#111111]">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-yellow-500/10 rounded-lg">
                        <Lock className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div>
                        <h2 className="text-sm font-medium text-white">{secret.metadata?.name}</h2>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                            <span>Secret</span>
                            <span>•</span>
                            <span>{secret.type}</span>
                        </div>
                    </div>
                </div>
                {/* AI Explain Button */}
                {/* AI Explain Button */}
                {onExplain && (
                    <button
                        onClick={onExplain}
                        disabled={isExplaining}
                        className={`
                            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                            transition-all duration-300 border
                            ${isExplaining
                                ? 'bg-purple-500/10 border-purple-500/20 text-purple-400 cursor-wait'
                                : 'bg-gradient-to-r from-blue-600/10 to-purple-600/10 hover:from-blue-600/20 hover:to-purple-600/20 text-blue-400 border-blue-500/20 hover:border-blue-500/30'
                            }
                        `}
                    >
                        {isExplaining ? (
                            <>
                                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                Analyzing...
                            </>
                        ) : (
                            <>
                                <span className="text-sm">✨</span> Explain
                            </>
                        )}
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {/* AI Explanation */}
                {explanation && (
                    <div className="bg-gradient-to-br from-purple-900/10 to-blue-900/10 rounded-lg p-4 border border-purple-500/20">
                        <div className="flex items-center gap-2 mb-2 text-purple-400">
                            <span className="text-lg">✨</span>
                            <h3 className="text-sm font-medium">AI Analysis</h3>
                        </div>
                        <div className="prose prose-invert prose-sm max-w-none text-gray-300 leading-relaxed">
                            {explanation}
                        </div>
                    </div>
                )}

                {/* TLS Certificate details */}
                {isTls && certScroll && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-white">
                            <Shield className="w-4 h-4 text-green-400" />
                            <span>Certificate Information</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-[#1a1a1a] rounded-lg p-3 border border-white/5 space-y-3">
                                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Subject</div>
                                <div className="text-sm text-gray-300 break-all pl-2 border-l-2 border-blue-500/30">
                                    {certScroll.subject ? (
                                        certScroll.subject.split('\n').map((line, i) => <div key={i}>{line}</div>)
                                    ) : (
                                        <div className="text-gray-500 italic">No subject info</div>
                                    )}
                                </div>
                            </div>
                            <div className="bg-[#1a1a1a] rounded-lg p-3 border border-white/5 space-y-3">
                                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Issuer</div>
                                <div className="text-sm text-gray-300 break-all pl-2 border-l-2 border-purple-500/30">
                                    {certScroll.issuer ? (
                                        certScroll.issuer.split('\n').map((line, i) => <div key={i}>{line}</div>)
                                    ) : (
                                        <div className="text-gray-500 italic">No issuer info</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="bg-[#1a1a1a] rounded-lg p-3 border border-white/5">
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Validity Period</div>
                            <div className="flex items-center gap-6">
                                <div>
                                    <div className="text-[10px] text-gray-500 mb-1">Valid From</div>
                                    <div className="flex items-center gap-2 text-sm text-gray-300">
                                        <Calendar className="w-3 h-3 text-gray-500" />
                                        {new Date(certScroll.validFrom).toLocaleString()}
                                    </div>
                                </div>
                                <div className="h-8 w-px bg-white/10" />
                                <div>
                                    <div className="text-[10px] text-gray-500 mb-1">Expires On</div>
                                    <div className={`flex items-center gap-2 text-sm ${new Date(certScroll.validTo) < new Date() ? 'text-red-400' : 'text-green-400'}`}>
                                        <Calendar className="w-3 h-3 text-current" />
                                        {new Date(certScroll.validTo).toLocaleString()}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {certScroll.sans && certScroll.sans.length > 0 && (
                            <div className="bg-[#1a1a1a] rounded-lg p-3 border border-white/5">
                                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">SANs (Subject Alternative Names)</div>
                                <div className="flex flex-wrap gap-2">
                                    {certScroll.sans.map((san, i) => (
                                        <div key={i} className="px-2 py-1 bg-white/5 rounded text-xs text-blue-300 border border-white/5">
                                            {san}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Secret Data */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                        <Key className="w-4 h-4 text-yellow-500" />
                        <span>Data</span>
                        <span className="text-xs text-gray-500 font-normal ml-auto">
                            {Object.keys(secret.data || {}).length} keys
                        </span>
                    </div>

                    <div className="space-y-2">
                        {secret.data && Object.keys(secret.data).map(key => {
                            const isHidden = hiddenKeys[key];
                            const rawValue = secret.data[key];
                            const displayValue = isHidden ? '••••••••' : decodeValue(rawValue);
                            const isTlsKey = key === 'tls.key';

                            // For TLS keys, keep them hidden by default and show warning style if revealed
                            return (
                                <div key={key} className="bg-[#1a1a1a] border border-white/5 rounded-lg overflow-hidden group hover:border-white/10 transition-colors">
                                    <div className="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/5">
                                        <div className="font-mono text-xs text-blue-300">{key}</div>
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
                                    <div className="p-3 bg-[#0a0a0a]">
                                        {isTlsKey && !isHidden ? (
                                            <div className="text-xs font-mono text-red-300 whitespace-pre-wrap break-all bg-red-900/10 p-2 rounded border border-red-500/20">
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

                {/* Metadata */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span>Metadata</span>
                    </div>
                    <div className="bg-[#1a1a1a] rounded-lg border border-white/5 p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Created At</div>
                                <div className="text-sm text-gray-300">
                                    {secret.metadata?.creationTimestamp ? new Date(secret.metadata.creationTimestamp).toLocaleString() : '-'}
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Namespace</div>
                                <div className="text-sm text-gray-300">{secret.metadata?.namespace}</div>
                            </div>
                        </div>
                        {secret.metadata?.labels && (
                            <div>
                                <div className="text-[10px] text-gray-500 mb-2 uppercase tracking-wider">Labels</div>
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(secret.metadata.labels).map(([k, v]) => (
                                        <div key={k} className="px-2 py-1 bg-white/5 rounded text-xs text-gray-400 border border-white/5">
                                            <span className="text-gray-500">{k}:</span> <span className="text-gray-300">{v as string}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {secret.metadata?.annotations && (
                            <div>
                                <div className="text-[10px] text-gray-500 mb-2 uppercase tracking-wider">Annotations</div>
                                <div className="flex flex-col gap-1">
                                    {Object.entries(secret.metadata.annotations).map(([k, v]) => (
                                        <div key={k} className="text-xs text-gray-400 font-mono">
                                            <span className="text-gray-500">{k}:</span> <span className="text-gray-300 break-all">{v as string}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
