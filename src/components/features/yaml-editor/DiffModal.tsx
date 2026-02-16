import { DiffEditor } from '@monaco-editor/react';
import { Check } from 'lucide-react';

interface DiffModalProps {
    original: string;
    modified: string;
    onConfirm: () => void;
    onCancel: () => void;
    isSaving?: boolean;
}

export const DiffModal: React.FC<DiffModalProps> = ({ original, modified, onConfirm, onCancel, isSaving }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8">
            <div className="bg-[#171717] border border-white/10 rounded-xl w-full h-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex-none px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#0a0a0a]">
                    <div>
                        <h2 className="text-lg font-bold text-white">Review Changes</h2>
                        <p className="text-xs text-gray-400">compare your changes before saving</p>
                    </div>
                </div>

                {/* Diff Editor */}
                <div className="flex-1 min-h-0 bg-[#0a0a0a]">
                    <DiffEditor
                        height="100%"
                        theme="lumen-dark"
                        original={original}
                        modified={modified}
                        options={{
                            renderSideBySide: true,
                            readOnly: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            fontSize: 13,
                        }}
                    />
                </div>

                {/* Footer */}
                <div className="flex-none px-6 py-4 border-t border-white/10 bg-[#0a0a0a] flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        disabled={isSaving}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isSaving}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSaving ? (
                            <>Saving...</>
                        ) : (
                            <><Check size={16} /> Confirm & Save</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
