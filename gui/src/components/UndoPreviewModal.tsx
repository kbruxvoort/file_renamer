

import { X, RotateCcw, ArrowRight } from 'lucide-react';

interface UndoOperation {
    src: string;
    dest: string;
    associated?: boolean;
}

interface HistoryBatch {
    batch_id: string;
    timestamp: string;
    operations: UndoOperation[];
}

interface UndoPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    batch: HistoryBatch | null;
    isUndoing: boolean;
}

export function UndoPreviewModal({ isOpen, onClose, onConfirm, batch, isUndoing }: UndoPreviewModalProps) {
    if (!isOpen || !batch) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[80vh]">

                {/* Header */}
                <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 rounded-t-xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-yellow-500/10 rounded-lg">
                            <RotateCcw size={24} className="text-yellow-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Undo Last Batch</h2>
                            <p className="text-xs text-gray-400">
                                {batch.timestamp ? new Date(batch.timestamp).toLocaleString() : 'Recently'} • {batch.operations.length} files
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div className="p-4 bg-yellow-900/10 border border-yellow-900/30 rounded-lg text-sm text-yellow-200/80 mb-4">
                        <p><strong>Warning:</strong> Verify that the files are still in their new locations. If you have moved or renamed them externally, undo might fail.</p>
                    </div>

                    <p className="text-sm text-gray-400 mb-2 font-medium">Files to be restored:</p>

                    <div className="space-y-1">
                        {batch.operations.map((op, idx) => (
                            <div key={idx} className="flex flex-col p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 text-sm">
                                <div className="flex items-center gap-2 text-red-300 line-through decoration-red-500/50 opacity-70">
                                    <span className="font-mono text-xs truncate max-w-[45%] direction-rtl" title={op.dest}>
                                        {op.dest}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-green-400 mt-1">
                                    <ArrowRight size={14} className="shrink-0" />
                                    <span className="font-mono text-xs truncate max-w-[95%] direction-rtl" title={op.src}>
                                        {op.src}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-800 bg-gray-900/50 flex justify-end gap-3 rounded-b-xl">
                    <button
                        onClick={onClose}
                        disabled={isUndoing}
                        className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isUndoing}
                        className={`flex items-center gap-2 px-6 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-yellow-900/20 ${isUndoing ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isUndoing ? 'Undoing...' : 'Confirm Undo'}
                    </button>
                </div>
            </div>
        </div>
    );
}
