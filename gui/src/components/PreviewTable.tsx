import { clsx } from 'clsx';
import { Film, Tv, Book, AlertCircle, CheckCircle, ArrowRight, Edit2, Headphones, Trash2 } from 'lucide-react';
import type { FileCandidate } from '../api';

export interface FileItem {
    original_path: string;
    filename: string;
    file_type: string;
    candidates: FileCandidate[];
    selected_index: number;
    proposed_path: string | null;
}

interface PreviewTableProps {
    files: FileItem[];
    onRowClick?: (index: number) => void;
    onRemove?: (index: number) => void;
}

export function PreviewTable({ files, onRowClick, onRemove }: PreviewTableProps) {
    if (files.length === 0) return null;

    return (
        <div className="w-full overflow-hidden rounded-xl border border-gray-700 bg-gray-800/50 shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-400">
                    <thead className="bg-gray-800 text-xs uppercase font-medium text-gray-500">
                        <tr>
                            <th className="px-6 py-4 w-12 text-center">Type</th>
                            <th className="px-6 py-4">Original Filename</th>
                            <th className="px-6 py-4 w-8"></th>
                            <th className="px-6 py-4 text-green-400">Proposed New Name</th>
                            <th className="px-6 py-4 text-center">Matches</th>
                            <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                        {files.map((file, idx) => {
                            const selectedCandidate = file.candidates[file.selected_index];
                            const displayType = selectedCandidate ? selectedCandidate.type : file.file_type;

                            const Icon = displayType === 'movie' ? Film :
                                displayType === 'tv' ? Tv :
                                    displayType === 'book' ? Book :
                                        displayType === 'audiobook' ? Headphones : AlertCircle;

                            const hasMultiple = file.candidates.length > 1;
                            const hasMatch = file.candidates.length > 0;

                            return (
                                <tr
                                    key={idx}
                                    className={clsx(
                                        "transition-colors group",
                                        onRowClick && "cursor-pointer hover:bg-gray-700/50"
                                    )}
                                    onClick={() => onRowClick?.(idx)}
                                >
                                    <td className="px-6 py-4 text-center">
                                        <Icon size={18} className={clsx(
                                            displayType === 'movie' && "text-blue-400",
                                            displayType === 'tv' && "text-purple-400",
                                            displayType === 'book' && "text-orange-400",
                                            displayType === 'audiobook' && "text-green-400",
                                            (displayType === 'unknown' || !hasMatch) && "text-gray-500"
                                        )} />
                                    </td>
                                    <td className="px-6 py-4 font-medium text-white truncate max-w-xs" title={file.filename}>
                                        {file.filename}
                                    </td>
                                    <td className="px-6 py-4 text-center text-gray-600">
                                        <ArrowRight size={16} />
                                    </td>
                                    <td className="px-6 py-4 text-green-300 font-mono text-xs truncate max-w-xs" title={file.proposed_path || ''}>
                                        {file.proposed_path ? file.proposed_path.split(/[/\\]/).pop() : '-'}
                                        {selectedCandidate ? (
                                            <div className="text-[10px] text-gray-500 truncate mt-1">
                                                Via: <span className="text-gray-400">{selectedCandidate.title}</span>
                                            </div>
                                        ) : (
                                            <div className="text-[10px] text-gray-500 truncate mt-1">
                                                Raw Parse
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {hasMatch ? (
                                            <span className={clsx(
                                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                                                hasMultiple
                                                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                                    : "bg-green-500/10 text-green-400 border border-green-500/20"
                                            )}>
                                                {hasMultiple ? (
                                                    <>Review ({file.candidates.length})</>
                                                ) : (
                                                    <><CheckCircle size={12} /> Auto-Match</>
                                                )}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                                                <AlertCircle size={12} />
                                                No match
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                                        <button
                                            className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRowClick?.(idx);
                                            }}
                                            title="Edit Selection"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemove?.(idx);
                                            }}
                                            title="Remove File"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="bg-gray-800/80 px-6 py-3 text-xs text-gray-500 border-t border-gray-700 flex justify-between">
                <span>{files.length} files found</span>
                <span>{files.filter(f => f.candidates.length > 0).length} matched</span>
            </div>
        </div>
    );
}
