import { CheckCircle, AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { buttonStyles } from './buttonStyles';
import type { ExecuteResult } from '../api';
import { baseName } from '../types';

interface ExecuteResultModalProps {
    result: ExecuteResult | null;
    onClose: () => void;
}

/** Outcome of a move: what moved, and exactly which files failed and why. */
export function ExecuteResultModal({ result, onClose }: ExecuteResultModalProps) {
    if (!result) return null;

    const mainMoves = result.moved.filter(m => !m.associated);
    const sidecars = result.moved.length - mainMoves.length;
    const hasErrors = result.errors.length > 0;

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={hasErrors ? 'Finished with errors' : 'Files moved'}
            subtitle={`${mainMoves.length} moved${sidecars ? ` (+${sidecars} subtitle/extra files)` : ''}, ${result.errors.length} failed, ${result.skipped.length} skipped`}
            icon={hasErrors
                ? <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-400"><AlertTriangle size={22} /></div>
                : <div className="p-2 bg-green-500/10 rounded-lg text-green-400"><CheckCircle size={22} /></div>}
            footer={<button onClick={onClose} className={buttonStyles.primary} autoFocus>Done</button>}
        >
            <div className="space-y-6">
                {hasErrors && (
                    <section>
                        <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">Failed</h3>
                        <p className="text-sm text-gray-400 mb-2">These files are still in the list, so you can fix the problem and move them again.</p>
                        <ul className="space-y-1">
                            {result.errors.map(e => (
                                <li key={e.file} className="text-sm px-3 py-2 rounded bg-red-900/20 border border-red-900/40">
                                    <div className="font-mono text-red-200 truncate" title={e.file}>{baseName(e.file)}</div>
                                    <div className="text-xs text-red-300/80">{e.error}</div>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {mainMoves.length > 0 && (
                    <section>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Moved</h3>
                        <ul className="space-y-1 max-h-72 overflow-y-auto">
                            {mainMoves.map(m => (
                                <li key={m.src} className="text-sm px-3 py-1.5 rounded bg-gray-800/40">
                                    <div className="text-gray-400 truncate" title={m.src}>{baseName(m.src)}</div>
                                    <div className="font-mono text-green-300 text-xs truncate" title={m.dest}>{m.dest}</div>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
        </Modal>
    );
}
