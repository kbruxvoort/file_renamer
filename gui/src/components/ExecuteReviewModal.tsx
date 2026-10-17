import { useMemo } from 'react';
import { AlertTriangle, ArrowRightLeft, Film, Tv, Book, Headphones } from 'lucide-react';
import { Modal } from './Modal';
import { buttonStyles } from './buttonStyles';
import { type FileItem, isMovable, parentDir } from '../types';

interface ExecuteReviewModalProps {
    isOpen: boolean;
    files: FileItem[];
    duplicateTargets: Set<string>;
    onClose: () => void;
    onConfirm: () => void;
}

const TYPE_META: Record<string, { label: string; Icon: typeof Film }> = {
    movie: { label: 'Movies', Icon: Film },
    tv: { label: 'TV episodes', Icon: Tv },
    book: { label: 'Books', Icon: Book },
    audiobook: { label: 'Audiobooks', Icon: Headphones },
};

/** Last look before anything moves: what goes where, and what will be left alone. */
export function ExecuteReviewModal({ isOpen, files, duplicateTargets, onClose, onConfirm }: ExecuteReviewModalProps) {
    const summary = useMemo(() => {
        const movable = files.filter(isMovable);
        const byType = new Map<string, number>();
        const roots = new Map<string, number>();
        for (const f of movable) {
            const type = f.candidates[f.selected_index].type;
            byType.set(type, (byType.get(type) ?? 0) + 1);
            // Group by the folder above each file's own folder (e.g. "TV Shows\Show", "Movies"),
            // which keeps the list short without hiding where things go
            if (f.proposed_path) {
                const dir = parentDir(parentDir(f.proposed_path)) || parentDir(f.proposed_path);
                roots.set(dir, (roots.get(dir) ?? 0) + 1);
            }
        }
        return {
            movable,
            byType,
            roots: Array.from(roots.entries()).sort((a, b) => b[1] - a[1]),
            unmatched: files.filter(f => !f.excluded && !f.candidates[f.selected_index]).length,
            excluded: files.filter(f => f.excluded).length,
            unreviewed: movable.filter(f => !f.confirmed && f.candidates.length > 1).length,
            conflicts: movable.filter(f => f.conflict || (f.proposed_path && duplicateTargets.has(f.proposed_path))).length,
        };
    }, [files, duplicateTargets]);

    const count = summary.movable.length;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Review before moving"
            subtitle={`${count} file${count !== 1 ? 's' : ''} will be renamed and moved`}
            icon={<div className="p-2 bg-blue-600/20 rounded-lg text-blue-400"><ArrowRightLeft size={22} /></div>}
            footer={<>
                <button onClick={onClose} className={buttonStyles.secondary}>Back</button>
                <button onClick={onConfirm} disabled={count === 0} className={buttonStyles.primary} autoFocus>
                    Move {count} file{count !== 1 ? 's' : ''}
                </button>
            </>}
        >
            <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {Object.entries(TYPE_META).map(([type, { label, Icon }]) => (
                        <div key={type} className="p-3 rounded-xl bg-gray-800/60 border border-gray-700/50">
                            <div className="flex items-center gap-2 text-gray-400 text-xs"><Icon size={14} /> {label}</div>
                            <div className="text-2xl font-semibold text-white mt-1">{summary.byType.get(type) ?? 0}</div>
                        </div>
                    ))}
                </div>

                {(summary.unreviewed > 0 || summary.conflicts > 0) && (
                    <div className="space-y-2">
                        {summary.unreviewed > 0 && (
                            <p className="flex items-center gap-2 text-sm text-yellow-300">
                                <AlertTriangle size={16} /> {summary.unreviewed} file{summary.unreviewed !== 1 ? 's use' : ' uses'} an unreviewed best-guess match.
                            </p>
                        )}
                        {summary.conflicts > 0 && (
                            <p className="flex items-center gap-2 text-sm text-yellow-300">
                                <AlertTriangle size={16} /> {summary.conflicts} destination{summary.conflicts !== 1 ? 's' : ''} already taken; those files get a " (1)" suffix.
                            </p>
                        )}
                    </div>
                )}

                {(summary.unmatched > 0 || summary.excluded > 0) && (
                    <p className="text-sm text-gray-400">
                        Left where they are: {summary.unmatched > 0 && `${summary.unmatched} without a match`}
                        {summary.unmatched > 0 && summary.excluded > 0 && ', '}
                        {summary.excluded > 0 && `${summary.excluded} you excluded`}.
                    </p>
                )}

                <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Destination folders</h3>
                    <ul className="space-y-1 max-h-60 overflow-y-auto">
                        {summary.roots.map(([dir, n]) => (
                            <li key={dir} className="flex items-center justify-between gap-4 text-sm font-mono px-3 py-1.5 rounded bg-gray-800/40">
                                <span className="truncate text-gray-300" title={dir}>{dir}</span>
                                <span className="shrink-0 text-gray-500">{n}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </Modal>
    );
}
