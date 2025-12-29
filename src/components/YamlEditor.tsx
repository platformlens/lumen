import React, { useState, useEffect } from 'react';
import { Save, AlertTriangle, Check } from 'lucide-react';
import { motion } from 'framer-motion';

interface YamlEditorProps {
    initialYaml: string;
    onSave: (newYaml: string) => Promise<void>;
    onClose?: () => void;
    isSaving?: boolean;
}

export const YamlEditor: React.FC<YamlEditorProps> = ({ initialYaml, onSave, onClose }) => {
    const [yaml, setYaml] = useState(initialYaml);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        setYaml(initialYaml);
        setIsDirty(false);
    }, [initialYaml]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setYaml(e.target.value);
        setIsDirty(true);
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            await onSave(yaml);
            setIsDirty(false);
        } catch (err: any) {
            setError(err.message || "Failed to save YAML");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300 font-mono text-sm relative">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#252526]">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">YAML Editor</span>
                    {isDirty && <span className="w-2 h-2 rounded-full bg-yellow-500" title="Unsaved changes"></span>}
                </div>
                <div className="flex items-center gap-2">
                     {error && (
                        <span className="text-xs text-red-400 flex items-center gap-1 mr-2 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                            <AlertTriangle size={12} /> {error}
                        </span>
                    )}
                    <button 
                        onClick={handleSave}
                        disabled={!isDirty || isSaving}
                        className={`
                            flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-all
                            ${!isDirty 
                                ? 'opacity-50 cursor-not-allowed bg-white/5 text-gray-400' 
                                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
                            }
                        `}
                    >
                        {isSaving ? (
                            <>Saving...</>
                        ) : (
                            <><Save size={14} /> Save Changes</>
                        )}
                    </button>
                </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 relative">
                <textarea 
                    value={yaml}
                    onChange={handleChange}
                    className="w-full h-full bg-[#1e1e1e] text-[#d4d4d4] p-4 font-mono text-sm resize-none focus:outline-none leading-relaxed selection:bg-blue-500/30"
                    spellCheck={false}
                    style={{
                        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
                    }}
                />
            </div>
            
            {/* Simple Status Bar */}
             <div className="px-4 py-1 bg-[#007acc] text-white text-[10px] flex justify-between">
                <span>YAML</span>
                <span>{yaml.split('\n').length} lines</span>
            </div>
        </div>
    );
};
