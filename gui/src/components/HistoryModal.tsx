import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { History, RotateCcw, ArrowRight, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { buttonStyles } from './buttonStyles';
import { getHistory, undoBatch, type HistoryBatch, type UndoResult } from '../api';
import { baseName, tailPath } from '../types';
import { toast } from './toast';

interface HistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUndone: () => void;  // history changed
}

/** All recorded batches; any of them can be inspected and undone. */
export function HistoryModal({ isOpen, onClose, onUndone }: HistoryModalProps) {
    const [batches, setBatches] = useState<HistoryBatch[] | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isUndoing, setIsUndoing] = useState(false);
    const [lastResult, setLastResult] = useState<UndoResult | null>(null);

    async function load(keepSelection = false) {
        try {
            const hist = await getHistory();
            setBatches(hist);
            if (!keepSelection || !hist.some(b => b.batch_id === selectedId)) {
                setSelectedId(hist[0]?.batch_id ?? null);
            }
        } catch (e) {
            setBatches([]);
            toast(e instanceof Error ? e.message : String(e), 'error');
        }
    }

    useEffect(() => {
        if (isOpen) {
            setLastResult(null);
            load();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const selected = batches?.find(b => b.batch_id === selectedId) ?? null;

    async function handleUndo() {
        if (!selected) return;
        setIsUndoing(true);
        try {
            const result = await undoBatch(selected.batch_id);
            setLastResult(result);
            if (result.success) {
                toast(`Restored ${result.restored_count} file${result.restored_count !== 1 ? 's' : ''}.`, 'success');
            }
            await load(true);
            onUndone();
        } catch (e) {
            toast(`Undo failed: ${e instanceof Error ? e.message : e}`, 'error');
        } finally {
            setIsUndoing(false);
        }
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            dismissable={!isUndoing}
            size="xl"
            title="History"
            subtitle="Undo any past batch. Files you've moved or renamed since then can't be restored."
            icon={<div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500"><History size={22} /></div>}
            footer={<>
                <button onClick={onClose} disabled={isUndoing} className={buttonStyles.secondary}>Close</button>
                <button onClick={handleUndo} disabled={!selected || isUndoing} className={clsx(buttonStyles.warning, "flex items-center gap-2")}>
                    {isUndoing ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                    {isUndoing ? 'Undoing...' : `Undo this batch${selected ? ` (${selected.operations.length})` : ''}`}
                </button>
            </>}
        >
            {batches === null ? (
                <div className="flex justify-center py-12 text-gray-500"><Loader2 className="animate-spin" /></div>
            ) : batches.length === 0 ? (
                <p className="text-center py-12 text-gray-500">Nothing to undo.</p>
            ) : (
                <div className="grid grid-cols-[16rem_1fr] gap-4 min-h-[20rem]">
                    <ul className="space-y-1 overflow-y-auto pr-1" aria-label="Batches">
                        {batches.map(b => (
                            <li key={b.batch_id}>
                                <button
                                    onClick={() => { setSelectedId(b.batch_id); setLastResult(null); }}
                                    className={clsx(
                                        "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                                        b.batch_id === selectedId ? "bg-blue-600/20 text-blue-200" : "text-gray-300 hover:bg-gray-800",
                                    )}
                                >
                                    <div className="font-medium">{b.timestamp ? new Date(b.timestamp).toLocaleString() : 'Unknown time'}</div>
                                    <div className="text-xs text-gray-500">{b.operations.length} file{b.operations.length !== 1 ? 's' : ''}</div>
                                </button>
                            </li>
                        ))}
                    </ul>

                    <div className="space-y-3 min-w-0">
                        {lastResult && lastResult.failure_count > 0 && (
                            <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-900/40 text-sm">
                                <p className="text-yellow-200 font-medium mb-1">
                                    Restored {lastResult.restored_count}; {lastResult.failure_count} could not be restored.
                                    {selected && ' The rest stay in history so you can retry.'}
                                </p>
                                <ul className="space-y-0.5 text-xs text-yellow-100/80">
                                    {lastResult.failures.map(f => <li key={f.file}><span className="font-mono">{baseName(f.file)}</span>: {f.error}</li>)}
                                </ul>
                            </div>
                        )}
                        {selected && (
                            <ul className="space-y-1">
                                {selected.operations.map(op => (
                                    <li key={op.dest} className="p-2 rounded bg-gray-800/40 text-xs font-mono">
                                        <div className="text-gray-400 truncate" title={op.dest}>{tailPath(op.dest, 4)}</div>
                                        <div className="flex items-center gap-1 text-green-400 truncate" title={op.src}>
                                            <ArrowRight size={12} className="shrink-0" /> {tailPath(op.src, 4)}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
}
