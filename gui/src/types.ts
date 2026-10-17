import type { FileCandidate } from './api';

export interface FileItem {
    original_path: string;
    filename: string;
    file_type: string;
    parsed_title: string | null;
    candidates: FileCandidate[];
    selected_index: number;
    proposed_path: string | null;
    conflict: boolean;     // Something already exists at proposed_path
    confirmed?: boolean;
    excluded?: boolean;    // User unticked it: left out of the move
}

export type FileStatus = 'ready' | 'review' | 'unmatched' | 'excluded';

export function fileStatus(f: FileItem): FileStatus {
    if (f.excluded) return 'excluded';
    if (!f.candidates[f.selected_index]) return 'unmatched';
    if (!f.confirmed && f.candidates.length > 1) return 'review';
    return 'ready';
}

/** Files that would actually be moved. */
export function isMovable(f: FileItem): boolean {
    return !f.excluded && !!f.candidates[f.selected_index];
}

export function parentDir(path: string): string {
    const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return idx === -1 ? '' : path.substring(0, idx);
}

export function baseName(path: string): string {
    return path.split(/[/\\]/).pop() || path;
}

/**
 * Shortens a path from the front so the meaningful end stays visible:
 * "C:\Users\me\Media\Movies\Inception (2010)" -> "…\Movies\Inception (2010)".
 * Long paths often share a prefix, so cutting the end makes them look identical.
 */
export function tailPath(path: string, segments = 3): string {
    const parts = path.split(/[/\\]/).filter(Boolean);
    if (parts.length <= segments) return path;
    const sep = path.includes('\\') ? '\\' : '/';
    return `…${sep}${parts.slice(-segments).join(sep)}`;
}
