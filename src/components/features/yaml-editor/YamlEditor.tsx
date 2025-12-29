import React, { useState, useEffect, useRef } from 'react';
import { Save, AlertTriangle } from 'lucide-react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';

interface YamlEditorProps {
    initialYaml: string;
    onSave: (newContent: string) => Promise<void>;
}

export const YamlEditor: React.FC<YamlEditorProps> = ({ initialYaml, onSave }) => {
    const [yaml, setYaml] = useState(initialYaml);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [cursorPosition, setCursorPosition] = useState({ lineNumber: 1, column: 1 });
    const editorRef = useRef<any>(null);

    useEffect(() => {
        setYaml(initialYaml);
        setIsDirty(false);
        if (editorRef.current) {
            editorRef.current.setValue(initialYaml);
        }
    }, [initialYaml]);

    const handleEditorWillMount: BeforeMount = (monaco) => {
        monaco.editor.defineTheme('lumen-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'key', foreground: '569cd6' },
                { token: 'string.value', foreground: 'ce9178' },
                { token: 'number', foreground: 'b5cea8' },
                { token: 'keyword', foreground: 'c586c0' }
            ],
            colors: {
                'editor.background': '#0a0a0a',
                'editorGutter.background': '#0a0a0a',
                'editor.lineHighlightBackground': '#ffffff05',
                'scrollbarSlider.background': '#ffffff10',
                'scrollbarSlider.hoverBackground': '#ffffff20',
                'scrollbarSlider.activeBackground': '#ffffff30',
                'editorWidget.background': '#171717',
                'editorWidget.border': '#333333'
            }
        });
    };

    const handleEditorDidMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        editor.setValue(yaml); // Ensure content is set on mount if it changed before mount
        
        // Add Cmd+S binding
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
             handleSave();
        });

        // Track cursor position
        editor.onDidChangeCursorPosition((e) => {
            setCursorPosition({
                lineNumber: e.position.lineNumber,
                column: e.position.column
            });
        });
    };

    const handleEditorChange = (value: string | undefined) => {
        const newValue = value || '';
        setYaml(newValue);
        setIsDirty(true);
    };

    const handleSave = async () => {
        if (!isDirty) return;
        
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
        <div className="flex flex-col h-full bg-[#0a0a0a] text-gray-300 font-mono text-sm relative overflow-hidden">
            {/* Toolbar */}
            <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-white/5 bg-[#171717]">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                         <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">YAML Editor</span>
                         {isDirty && <span className="w-2 h-2 rounded-full bg-yellow-500" title="Unsaved changes"></span>}
                    </div>
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
                        title="Save Changes (Cmd+S)"
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
            <div className="flex-1 min-h-0 relative overflow-hidden bg-[#0a0a0a]">
                <Editor
                    height="100%"
                    defaultLanguage="yaml"
                    theme="lumen-dark"
                    value={yaml}
                    beforeMount={handleEditorWillMount}
                    onMount={handleEditorDidMount}
                    onChange={handleEditorChange}
                    options={{
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
                        automaticLayout: true,
                        wordWrap: 'on',
                        renderWhitespace: 'none',
                        lineNumbers: 'on',
                        glyphMargin: false,
                        folding: true,
                        lineDecorationsWidth: 10,
                        lineNumbersMinChars: 3,
                        contextmenu: true,
                        padding: { top: 16, bottom: 16 }
                    }}
                />
            </div>
            
            {/* Status Bar - Extended height to be visible above app StatusBar (24px) */}
             <div 
                className="flex-none px-4 bg-[#007acc] text-white text-xs flex justify-between items-center select-none"
                style={{
                    height: '24px',
                    minHeight: '24px'
                }}
             >
                <div className="flex gap-4">
                    <span className="font-semibold">YAML</span>
                    <span className="opacity-80">UTF-8</span>
                </div>
                <div className="flex gap-6">
                     <span>Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}</span>
                     <span className="opacity-80">CMD+F to Find</span>
                </div>
            </div>
        </div>
    );
};
