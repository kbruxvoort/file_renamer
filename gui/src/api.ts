
export interface FileCandidate {
    title: string;
    year?: number;
    overview?: string;
    poster_url?: string;
    id?: number;
    type: string;
    score?: number;
    author?: string;
}

export interface ScannedFile {
    original_path: string;
    filename: string;
    file_type: string;
    candidates: FileCandidate[];
    selected_index: number;
    proposed_path?: string;
}

export interface ScanResponse {
    files: ScannedFile[];
    source_dir: string;
    dest_dir: string;
}

const API_BASE = "http://127.0.0.1:8742";

export async function scanDirectory(paths: string | string[] | null): Promise<ScanResponse> {
    const payload: any = { min_size_mb: 0 };

    if (Array.isArray(paths)) {
        payload.paths = paths;
    } else if (paths) {
        payload.path = paths; // or payload.paths = [paths]
    }

    const res = await fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Scan failed");
    }

    return res.json();
}

export async function manualSearch(query: string, type: string): Promise<FileCandidate[]> {
    const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, type })
    });

    if (!res.ok) {
        throw new Error("Search failed");
    }

    const data = await res.json();
    return data.candidates;
}

export interface ExecuteResult {
    moved: any[];
    errors: any[];
    total_moved: number;
    total_errors: number;
}

export async function executeMoves(payload: { files: any[] }): Promise<ExecuteResult> {
    const res = await fetch(`${API_BASE}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Execute failed");
    }

    return res.json();
}

export async function getConfig(): Promise<any> {
    const res = await fetch(`${API_BASE}/config`);
    if (!res.ok) throw new Error("Failed to load config");
    return res.json();
}

export async function previewRename(original_path: string, selected_candidate: FileCandidate): Promise<string> {
    const res = await fetch(`${API_BASE}/preview_rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original_path, selected_candidate })
    });

    if (!res.ok) return "";
    const data = await res.json();
    return data.proposed_path;
}

export async function undoLastOperation(): Promise<{ success: boolean; message?: string; restored_count?: number }> {
    const res = await fetch(`${API_BASE}/undo`, {
        method: 'POST'
    });

    // Always return json even if error status, as our API returns details
    return res.json();
}
