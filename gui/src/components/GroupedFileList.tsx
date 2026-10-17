import { useState, useMemo, useEffect, useRef } from 'react';
import {
    ChevronDown, ChevronRight, Folder,
    Film, Tv, Book, Headphones,
    CheckCircle, AlertCircle, AlertTriangle,
    Edit2, Trash2, ArrowRight, Replace
} from 'lucide-react';
import { clsx } from 'clsx';
import { type FileItem, type FileStatus, fileStatus, parentDir, baseName } from '../types';

export type FileFilter = 'all' | FileStatus;

interface GroupedFileListProps {
    files: FileItem[];
    filter: FileFilter;
    duplicateTargets: Set<string>;
    onRowClick: (index: number) => void;
    onRemove: (index: number) => void;
    onSetExcluded: (indices: number[], excluded: boolean) => void;
    onChangeGroupMatch: (indices: number[]) => void;
}

interface Group {
    key: string;
    isContentGroup: boolean;
    indices: number[];
}

export function GroupedFileList({ files, filter, duplicateTargets, onRowClick, onRemove, onSetExcluded, onChangeGroupMatch }: GroupedFileListProps) {
    // Group by matched content (show/movie id) or, for unmatched files, by folder
    const groups = useMemo(() => {
        const map = new Map<string, Group>();

        files.forEach((f, index) => {
            if (filter !== 'all' && fileStatus(f) !== filter) return;
            const candidate = f.candidates[f.selected_index];

            let key: string;
            let isContentGroup = false;
            if (candidate?.id) {
                key = `${candidate.type}::${candidate.id}`;
                isContentGroup = true;
            } else if (candidate?.title) {
                key = `title::${candidate.type}::${candidate.title}`;
                isContentGroup = true;
            } else {
                key = `folder::${parentDir(f.original_path)}`;
            }

            if (!map.has(key)) map.set(key, { key, isContentGroup, indices: [] });
            map.get(key)!.indices.push(index);
        });

        return Array.from(map.values());
    }, [files, filter]);

    if (groups.length === 0) {
        return <p className="text-center text-gray-500 py-12">No files match this filter.</p>;
    }

    return (
        <div className="space-y-6">
            {groups.map(group => (
                <ContentGroup
                    key={group.key}
                    group={group}
                    files={files}
                    duplicateTargets={duplicateTargets}
                    onRowClick={onRowClick}
                    onRemove={onRemove}
                    onSetExcluded={onSetExcluded}
                    onChangeGroupMatch={onChangeGroupMatch}
                />
            ))}
        </div>
    );
}

function TypeIcon({ type, size = 18 }: { type: string; size?: number }) {
    const Icon = type === 'movie' ? Film : type === 'tv' ? Tv : type === 'book' ? Book : type === 'audiobook' ? Headphones : AlertCircle;
    const color = type === 'movie' ? "text-blue-400" : type === 'tv' ? "text-purple-400" :
        type === 'book' ? "text-orange-400" : type === 'audiobook' ? "text-green-400" : "text-gray-500";
    return <Icon size={size} className={color} aria-label={type} />;
}

function ContentGroup({ group, files, duplicateTargets, onRowClick, onRemove, onSetExcluded, onChangeGroupMatch }: {
    group: Group;
    files: FileItem[];
    duplicateTargets: Set<string>;
    onRowClick: (idx: number) => void;
    onRemove: (idx: number) => void;
    onSetExcluded: (indices: number[], excluded: boolean) => void;
    onChangeGroupMatch: (indices: number[]) => void;
}) {
    const [isExpanded, setIsExpanded] = useState(true);
    const checkboxRef = useRef<HTMLInputElement>(null);

    const groupFiles = group.indices.map(i => files[i]);
    const first = groupFiles[0];
    const firstCand = first?.candidates[first.selected_index];

    let groupTitle: string;
    let groupYear: number | undefined;
    let groupSubtitle: string;
    if (group.isContentGroup && firstCand) {
        groupTitle = firstCand.title;
        groupYear = firstCand.type === 'tv' ? undefined : firstCand.year;
        // Source folder names, so you can see where the files came from
        groupSubtitle = Array.from(new Set(groupFiles.map(f => baseName(parentDir(f.original_path))))).join(', ');
    } else {
        const folderPath = group.key.replace('folder::', '');
        groupTitle = baseName(folderPath) || folderPath;
        groupSubtitle = folderPath;
    }

    const movableCount = groupFiles.filter(f => !f.excluded).length;
    const allExcluded = movableCount === 0;
    const someExcluded = movableCount > 0 && movableCount < groupFiles.length;
    const hasUncertain = groupFiles.some(f => fileStatus(f) === 'review');
    const hasUnmatched = groupFiles.some(f => fileStatus(f) === 'unmatched');

    useEffect(() => {
        if (checkboxRef.current) checkboxRef.current.indeterminate = someExcluded;
    }, [someExcluded]);

    return (
        <div className="border border-gray-700/50 rounded-xl overflow-hidden bg-gray-800/20">
            {/* Group Header */}
            <div className="flex items-center justify-between p-4 bg-gray-800/50 gap-3">
                <div className="flex items-center gap-3 overflow-hidden">
                    <input
                        ref={checkboxRef}
                        type="checkbox"
                        className="w-4 h-4 accent-blue-500 shrink-0"
                        checked={!allExcluded}
                        onChange={() => onSetExcluded(group.indices, !allExcluded)}
                        aria-label={`Include ${groupTitle}`}
                        title="Include these files in the move"
                    />
                    <button
                        className="flex items-center gap-3 min-w-0 text-left"
                        onClick={() => setIsExpanded(!isExpanded)}
                        aria-expanded={isExpanded}
                    >
                        <span className="text-gray-400">{isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}</span>
                        {firstCand ? <TypeIcon type={firstCand.type} size={20} /> : <Folder size={20} className="text-gray-400" />}
                        <span className="min-w-0">
                            <span className="flex items-center gap-2">
                                <span className="font-semibold text-lg text-gray-200 truncate">
                                    {groupTitle} {groupYear ? `(${groupYear})` : ''}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300 flex-none">
                                    {groupFiles.length} item{groupFiles.length !== 1 ? 's' : ''}
                                </span>
                            </span>
                            <span className="block text-xs text-gray-500 font-mono truncate max-w-lg">{groupSubtitle}</span>
                        </span>
                    </button>
                </div>

                <div className="flex items-center gap-3 flex-none">
                    {group.indices.length > 0 && (
                        <button
                            onClick={() => onChangeGroupMatch(group.indices)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 bg-gray-700/60 hover:bg-gray-700"
                            title="Pick one match for every file in this group"
                        >
                            <Replace size={14} /> {firstCand ? 'Change match' : 'Find match'}
                        </button>
                    )}
                    {allExcluded ? (
                        <span className="text-gray-500 text-sm">Excluded</span>
                    ) : hasUnmatched ? (
                        <span className="flex items-center gap-1.5 text-red-400 text-sm font-medium"><AlertCircle size={16} /> No match</span>
                    ) : hasUncertain ? (
                        <span className="flex items-center gap-1.5 text-yellow-500 text-sm font-medium"><AlertCircle size={16} /> Review</span>
                    ) : (
                        <span className="flex items-center gap-1.5 text-green-500 text-sm font-medium"><CheckCircle size={16} /> Ready</span>
                    )}
                </div>
            </div>

            {/* Children */}
            {isExpanded && (
                <ul className="border-t border-gray-700/50 divide-y divide-gray-800">
                    {group.indices.map(index => (
                        <FileRow
                            key={files[index].original_path}
                            file={files[index]}
                            isDuplicate={!!files[index].proposed_path && duplicateTargets.has(files[index].proposed_path!)}
                            onOpen={() => onRowClick(index)}
                            onRemove={() => onRemove(index)}
                            onToggle={() => onSetExcluded([index], !files[index].excluded)}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

function FileRow({ file, isDuplicate, onOpen, onRemove, onToggle }: {
    file: FileItem;
    isDuplicate: boolean;
    onOpen: () => void;
    onRemove: () => void;
    onToggle: () => void;
}) {
    const candidate = file.candidates[file.selected_index];
    const status = fileStatus(file);
    const matchCount = file.candidates.length;
    const displayType = candidate ? candidate.type : file.file_type;
    const destDir = file.proposed_path ? parentDir(file.proposed_path) : null;
    const collides = file.conflict || isDuplicate;

    return (
        <li className={clsx(
            "flex items-center p-3 gap-4 hover:bg-gray-800/30 transition-colors px-6",
            status === 'review' && "bg-yellow-500/5",
            status === 'excluded' && "opacity-50",
        )}>
            <input
                type="checkbox"
                className="w-4 h-4 accent-blue-500 shrink-0"
                checked={!file.excluded}
                onChange={onToggle}
                aria-label={`Include ${file.filename}`}
            />

            <div className="flex-none w-6 flex justify-center"><TypeIcon type={displayType} /></div>

            {/* Old Name */}
            <button className="flex-1 min-w-0 text-left" onClick={onOpen} title={file.original_path}>
                <div className="text-sm text-gray-300 font-medium truncate">{file.filename}</div>
                <div className="text-[11px] text-gray-500 font-mono truncate">{parentDir(file.original_path)}</div>
            </button>

            <div className="text-gray-600 flex-none"><ArrowRight size={16} /></div>

            {/* New Name + destination folder */}
            <button className="flex-1 min-w-0 text-left" onClick={onOpen} title={file.proposed_path || undefined}>
                {file.proposed_path ? (
                    <>
                        <div className={clsx("text-sm font-medium truncate font-mono", status === 'review' ? "text-yellow-200" : "text-green-300")}>
                            {baseName(file.proposed_path)}
                        </div>
                        <div className="text-[11px] text-gray-500 font-mono truncate">{destDir}</div>
                        {collides && (
                            <div className="flex items-center gap-1 text-[11px] text-yellow-400">
                                <AlertTriangle size={11} />
                                {file.conflict ? 'Already exists; will be saved as " (1)"' : 'Same destination as another file'}
                            </div>
                        )}
                    </>
                ) : candidate ? (
                    <span className="text-gray-500 text-sm">Working out new name...</span>
                ) : <span className="text-gray-600 text-sm">Not moved without a match</span>}
            </button>

            {/* Status and Actions */}
            <div className="flex items-center gap-2 pl-2 flex-none justify-end">
                {status === 'unmatched' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 whitespace-nowrap">
                        <AlertCircle size={12} /> No match
                    </span>
                ) : status === 'review' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
                        Review ({matchCount})
                    </span>
                ) : status === 'ready' ? (
                    <span className={clsx(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap",
                        file.confirmed ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-green-500/10 text-green-400 border-green-500/20"
                    )}>
                        <CheckCircle size={12} /> {file.confirmed ? 'Confirmed' : 'Auto-Match'}
                    </span>
                ) : null}

                <button
                    className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-700 hover:text-blue-400 focus-visible:text-blue-400 transition-colors"
                    onClick={onOpen}
                    title={matchCount > 1 ? "Change match" : "Edit match"}
                    aria-label={`Edit match for ${file.filename}`}
                >
                    <Edit2 size={16} />
                </button>
                <button
                    className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-700 hover:text-red-400 focus-visible:text-red-400 transition-colors"
                    onClick={onRemove}
                    title="Remove from list"
                    aria-label={`Remove ${file.filename} from list`}
                >
                    <Trash2 size={16} />
                </button>
            </div>
        </li>
    );
}
