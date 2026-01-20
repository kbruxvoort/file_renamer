import type { FileCandidate } from './api';

export interface FileItem {
    original_path: string;
    filename: string;
    file_type: string;
    candidates: FileCandidate[];
    selected_index: number;
    proposed_path: string | null;
    confirmed?: boolean;
}
