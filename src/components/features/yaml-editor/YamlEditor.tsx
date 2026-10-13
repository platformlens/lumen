import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Save, AlertTriangle, Eye, EyeOff, FileDiff, Server } from 'lucide-react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import { stripManagedFields } from '../../../utils/yaml-utils';
import { computeDraft } from '../../../utils/yaml-draft-utils';
import { DiffModal } from './DiffModal';

interface YamlEditorProps {
    /** Latest server/file content (the "base" the draft is diffed against). */
    initialYaml: string;
    /** Unsaved draft to restore on mount (e.g. after switching back to this tab). */
    initialDraft?: string;
    onSave: (newContent: string) => Promise<void>;
    /** Reports the current unsaved draft, or `undefined` when the editor matches the base. */
    onDraftChange?: (draft: string | undefined) => void;
    /** Kube context the save will be applied to (shown in the toolbar). */
    contextLabel?: string;
}

export const YamlEditor: React.FC<YamlEditorProps> = React.memo(({ initialYaml, initialDraft, onSave, onDraftChange, contextLabel }) => {
    const [yaml, setYaml] = useState(initialDraft ?? initialYaml);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isDirty, setIsDirtyState] = useState(initialDraft !== undefined && initialDraft !== initialYaml);
    const [cursorPosition, setCursorPosition] = useState({ lineNumber: 1, column: 1 });
    const [hideSystemFields, setHideSystemFields] = useState(false);
    const [isReviewing, setIsReviewing] = useState(false);

    // Refs mirror state so effects / Monaco commands always read the latest values
    const isDirtyRef = useRef(isDirty);
    const isSavingRef = useRef(false);
    const handleSaveRef = useRef<() => void>(() => { });

    const setIsDirty = (value: boolean) => {
        isDirtyRef.current = value;
        setIsDirtyState(value);
    };

    // What the editor shows when there are no unsaved edits
    const displayedBase = useMemo(
        () => (hideSystemFields ? stripManagedFields(initialYaml) : initialYaml),
        [initialYaml, hideSystemFields]
    );

    // Apply external content changes (fresh load, post-save refresh, "Hide System Fields" toggle)
    // but never clobber an unsaved draft. During a save the server response replaces the content.
    useEffect(() => {
        if (isDirtyRef.current && !isSavingRef.current) return;
        setYaml(displayedBase);
        isDirtyRef.current = false;
        setIsDirtyState(false);
    }, [displayedBase]);

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
        // Content is driven by the controlled `value` prop; no setValue here so
        // programmatic updates never fire onChange / mark the editor dirty.

        // Cmd+S — go through the ref so the latest handleSave (and isDirty) is used
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            handleSaveRef.current();
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
        const draft = computeDraft(newValue, displayedBase);
        setIsDirty(draft !== undefined);
        onDraftChange?.(draft);
    };

    const handleSave = async () => {
        if (!isDirty && !hideSystemFields) return;

        isSavingRef.current = true;
        setIsSaving(true);
        setError(null);
        try {
            await onSave(yaml);
            setIsDirty(false);
            onDraftChange?.(undefined);
            setIsReviewing(false);
        } catch (err: unknown) {
            setError(err instanceof Error && err.message ? err.message : 'Failed to save YAML');
        } finally {
            isSavingRef.current = false;
            setIsSaving(false);
        }
    };
    handleSaveRef.current = () => { void handleSave(); };

    const handleToggleSystemFields = () => {
        if (isDirty) return; // Prevent toggling if edits exist to avoid conflict
        setHideSystemFields(!hideSystemFields);
    };

    return (
        <div className="flex flex-col h-full bg-[#0a0a0a] text-gray-300 font-mono text-sm relative overflow-hidden">
            {/* Toolbar */}
            <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-white/5 bg-[#171717]">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">YAML Editor</span>
                        {isDirty && <span className="w-2 h-2 rounded-full bg-yellow-500" title="Unsaved changes"></span>}
                        {contextLabel && (
                            <span
                                className="flex items-center gap-1 text-xs text-gray-400 bg-white/5 px-2 py-0.5 rounded-md font-mono truncate"
                                title={`Changes will be applied to context ${contextLabel}`}
                            >
                                <Server size={12} className="shrink-0" />
                                <span className="truncate">{contextLabel}</span>
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {error && (
                        <span className="text-xs text-red-400 flex items-center gap-1 mr-2 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                            <AlertTriangle size={12} /> {error}
                        </span>
                    )}

                    <button
                        onClick={handleToggleSystemFields}
                        disabled={isDirty}
                        title={isDirty ? "Save changes to toggle view" : "Toggle managed fields"}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all ${hideSystemFields ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-white/5 text-gray-400 hover:text-gray-200'
                            } ${isDirty ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {hideSystemFields ? <EyeOff size={14} /> : <Eye size={14} />}
                        {hideSystemFields ? 'System Fields Hidden' : 'Hide System Fields'}
                    </button>

                    <div className="h-4 w-px bg-white/10 mx-1" />

                    <button
                        onClick={() => setIsReviewing(true)}
                        disabled={!isDirty || isSaving}
                        className={`
                            flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-all
                            ${!isDirty
                                ? 'opacity-50 cursor-not-allowed bg-white/5 text-gray-400'
                                : 'bg-white/10 hover:bg-white/20 text-white'
                            }
                        `}
                        title="Review Changes"
                    >
                        <FileDiff size={14} /> Review
                    </button>

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
                            <><Save size={14} /> Save</>
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

            {/* Status Bar */}
            <div
                className="flex-none px-4 bg-[#007acc] text-white text-xs flex justify-between items-center select-none"
                style={{ height: '24px', minHeight: '24px' }}
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

            {/* Diff Modal */}
            {isReviewing && (
                <DiffModal
                    original={displayedBase}
                    modified={yaml}
                    onConfirm={handleSave}
                    onCancel={() => setIsReviewing(false)}
                    isSaving={isSaving}
                />
            )}
        </div>
    );
});
