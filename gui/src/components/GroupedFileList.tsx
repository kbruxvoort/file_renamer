import { useState, useMemo } from 'react';
import {
    ChevronDown, ChevronRight, Folder,
    Film, Tv, Book, Headphones,
    CheckCircle, AlertCircle,
    Edit2, Trash2, ArrowRight
} from 'lucide-react';
import { clsx } from 'clsx';
import type { FileItem } from '../types';

interface GroupedFileListProps {
    files: FileItem[];
    onRowClick: (index: number) => void;
    onRemove: (index: number) => void;
}

export function GroupedFileList({ files, onRowClick, onRemove }: GroupedFileListProps) {
    // derived state: group by content (show/movie ID) or folder for unmatched
    const groups = useMemo(() => {
        const map = new Map<string, { files: FileItem[], groupKey: string, isContentGroup: boolean }>();

        files.forEach(f => {
            const candidate = f.candidates[f.selected_index];

            // Determine group key
            let groupKey: string;
            let isContentGroup = false;

            if (candidate?.id) {
                // Group by content type + ID (e.g., "tv::1396" for Breaking Bad)
                groupKey = `${candidate.type}::${candidate.id}`;
                isContentGroup = true;
            } else if (candidate?.title) {
                // Fallback to title if no ID but has match
                groupKey = `title::${candidate.title}`;
                isContentGroup = true;
            } else {
                // No match - group by folder
                const platformSep = f.original_path.includes('\\') ? '\\' : '/';
                const parts = f.original_path.split(platformSep);
                parts.pop(); // remove filename
                groupKey = `folder::${parts.join(platformSep)}`;
            }

            if (!map.has(groupKey)) {
                map.set(groupKey, { files: [], groupKey, isContentGroup });
            }
            map.get(groupKey)!.files.push(f);
        });

        return map;
    }, [files]);

    return (
        <div className="space-y-6">
            {Array.from(groups.entries()).map(([key, group]) => (
                <ContentGroup
                    key={key}
                    groupKey={group.groupKey}
                    files={group.files}
                    allFiles={files}
                    isContentGroup={group.isContentGroup}
                    onRowClick={onRowClick}
                    onRemove={onRemove}
                />
            ))}
        </div>
    );
}

function ContentGroup({ groupKey, files, allFiles, isContentGroup, onRowClick, onRemove }: {
    groupKey: string,
    files: FileItem[],
    allFiles: FileItem[],
    isContentGroup: boolean,
    onRowClick: (idx: number) => void,
    onRemove: (idx: number) => void
}) {
    const [isExpanded, setIsExpanded] = useState(true);

    // Group Intelligence - use first file's candidate for title/year
    const firstCand = files[0]?.candidates[files[0]?.selected_index];

    // Determine display title and year
    let groupTitle = "";
    let groupYear = null;
    let groupSubtitle = "";

    if (isContentGroup && firstCand) {
        // Content group - use matched title
        groupTitle = firstCand.title;
        groupYear = firstCand.year;
        // Show source folders as subtitle
        const folders = new Set(files.map(f => {
            const parts = f.original_path.split(/[/\\]/);
            parts.pop();
            return parts.pop() || '';
        }));
        groupSubtitle = Array.from(folders).join(', ');
    } else {
        // Folder-based fallback for unmatched
        const folderPath = groupKey.replace('folder::', '');
        groupTitle = folderPath.split(/[/\\]/).pop() || folderPath;
        groupSubtitle = folderPath;
    }

    // Check if this looks like a "Show Folder" or a "Mixed Bag"
    // Heuristic: If >1 items and ALL match the same Show Title, it's a Show.
    const allSameTitle = files.every(f => {
        const c = f.candidates[f.selected_index];
        return c && firstCand && c.title === firstCand.title;
    });

    const isMixed = !allSameTitle || files.length === 0;

    // Stats
    const hasUncertain = files.some(f => !f.confirmed && f.candidates.length > 1);

    return (
        <div className="border border-gray-700/50 rounded-xl overflow-hidden bg-gray-800/20">
            {/* Group Header */}
            <div
                className="flex items-center justify-between p-4 bg-gray-800/50 hover:bg-gray-800 transition-colors cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <button className="text-gray-400">
                        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </button>

                    <Folder size={20} className={isMixed ? "text-gray-400" : "text-blue-400"} />

                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-lg text-gray-200 truncate">
                                {groupTitle} {groupYear ? `(${groupYear})` : ''}
                            </h3>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 flex-none">
                                {files.length} items
                            </span>
                        </div>
                        <div className="text-xs text-gray-500 font-mono truncate max-w-lg">
                            {groupSubtitle}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4 flex-none ml-2">
                    {hasUncertain ? (
                        <div className="flex items-center gap-1.5 text-yellow-500 text-sm font-medium">
                            <AlertCircle size={16} />
                            <span>Review Needed</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 text-green-500 text-sm font-medium">
                            <CheckCircle size={16} />
                            <span>Ready</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Children */}
            {isExpanded && (
                <div className="border-t border-gray-700/50">
                    <div className="divide-y divide-gray-800">
                        {files.map((file) => {
                            const globalIndex = allFiles.indexOf(file);
                            const candidate = file.candidates[file.selected_index];
                            const matchCount = file.candidates.length;
                            const hasMultiple = matchCount > 1;
                            const hasMatch = matchCount > 0;

                            const displayType = candidate ? candidate.type : file.file_type;

                            // Icon Styling
                            const Icon = displayType === 'movie' ? Film :
                                displayType === 'tv' ? Tv :
                                    displayType === 'book' ? Book :
                                        displayType === 'audiobook' ? Headphones : AlertCircle;

                            const iconColor = displayType === 'movie' ? "text-blue-400" :
                                displayType === 'tv' ? "text-purple-400" :
                                    displayType === 'book' ? "text-orange-400" :
                                        displayType === 'audiobook' ? "text-green-400" : "text-gray-500";

                            return (
                                <div
                                    key={file.original_path}
                                    className={clsx(
                                        "flex items-center p-3 gap-4 hover:bg-gray-800/30 transition-colors group px-6",
                                        // Highlight uncertain ones slightly
                                        (!file.confirmed && hasMultiple) ? "bg-yellow-500/5" : ""
                                    )}
                                    onClick={() => onRowClick(globalIndex)}
                                >
                                    {/* Icon */}
                                    <div className="flex-none w-8 flex justify-center">
                                        <Icon size={18} className={iconColor} />
                                    </div>

                                    {/* Old Name */}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm text-gray-300 font-medium truncate" title={file.filename}>
                                            {file.filename}
                                        </div>
                                    </div>

                                    {/* Arrow */}
                                    <div className="text-gray-600 flex-none px-2">
                                        <ArrowRight size={16} />
                                    </div>

                                    {/* New Name */}
                                    <div className="flex-1 min-w-0">
                                        {file.proposed_path ? (
                                            <>
                                                <div className={clsx("text-sm font-medium truncate font-mono", (!file.confirmed && hasMultiple) ? "text-yellow-200" : "text-green-300")} title={file.proposed_path}>
                                                    {file.proposed_path.split(/[/\\]/).pop()}
                                                </div>
                                                {candidate && (
                                                    <div className="text-[10px] text-gray-500 truncate">
                                                        Via: {candidate.title}
                                                    </div>
                                                )}
                                            </>
                                        ) : <span className="text-gray-600">-</span>}
                                    </div>

                                    {/* Status and Actions */}
                                    <div className="flex items-center gap-4 pl-4 flex-none w-48 justify-end">
                                        {/* Status Badge */}
                                        {hasMatch ? (
                                            <span className={clsx(
                                                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap",
                                                file.confirmed
                                                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                                    : hasMultiple
                                                        ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                                                        : "bg-green-500/10 text-green-400 border-green-500/20"
                                            )}>
                                                {file.confirmed ? (
                                                    <><CheckCircle size={12} /> Confirmed</>
                                                ) : hasMultiple ? (
                                                    <>Review ({matchCount})</>
                                                ) : (
                                                    <><CheckCircle size={12} /> Auto-Match</>
                                                )}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 whitespace-nowrap">
                                                <AlertCircle size={12} /> No match
                                            </span>
                                        )}

                                        {/* Action Buttons - all hover-based for cleaner UI */}
                                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-blue-400 transition-colors"
                                                onClick={(e) => { e.stopPropagation(); onRowClick(globalIndex); }}
                                                title={hasMultiple ? "Change match" : "Edit"}
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                            <button
                                                className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors"
                                                onClick={(e) => { e.stopPropagation(); onRemove(globalIndex); }}
                                                title="Remove"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
