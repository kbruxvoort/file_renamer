
export interface FileCandidate {
    title: string;
    year?: number;
    overview?: string;
    poster_url?: string;
    id?: number;
    type: string;
    score?: number;
    author?: string;
    episode_title?: string;
}

export interface ScannedFile {
    original_path: string;
    filename: string;
    file_type: string;
    candidates: FileCandidate[];
    selected_index: number;
    proposed_path?: string;
}

export async function sendHeartbeat(): Promise<void> {
    try {
        const baseUrl = await getApiBase();
        await fetch(`${baseUrl}/heartbeat`, { method: 'POST' });
    } catch (e) {
        console.error("Heartbeat failed:", e);
    }
}

export interface ScanResponse {
    files: ScannedFile[];
    source_dir: string;
    dest_dir: string;
}

import { invoke } from "@tauri-apps/api/core";

let apiBaseUrl: string | null = null;

async function getApiBase(): Promise<string> {
    if (apiBaseUrl) return apiBaseUrl;

    // In development, prefer local python server if available
    // if (import.meta.env.DEV) {
    //    console.log("Dev mode: Using local API at 8742");
    //    apiBaseUrl = "http://127.0.0.1:8742";
    //    return apiBaseUrl;
    // }

    try {
        const port = await invoke<number>("get_api_port");
        apiBaseUrl = `http://127.0.0.1:${port}`;
    } catch (e) {
        console.warn("Failed to get dynamic port, falling back to default:", e);
        apiBaseUrl = "http://127.0.0.1:8742";
    }
    return apiBaseUrl;
}

export async function scanDirectory(paths: string | string[] | null): Promise<ScanResponse> {
    const payload: any = { min_size_mb: 0 };

    if (Array.isArray(paths)) {
        payload.paths = paths;
    } else if (paths) {
        payload.path = paths; // or payload.paths = [paths]
    }

    const baseUrl = await getApiBase();
    const res = await fetch(`${baseUrl}/scan`, {
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
    const baseUrl = await getApiBase();
    const res = await fetch(`${baseUrl}/search`, {
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
    const baseUrl = await getApiBase();
    const res = await fetch(`${baseUrl}/execute`, {
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

export async function getConfig(reveal_keys: boolean = false): Promise<any> {
    const baseUrl = await getApiBase();
    const res = await fetch(`${baseUrl}/config?reveal_keys=${reveal_keys}`);
    if (!res.ok) throw new Error("Failed to load config");
    return res.json();
}

export async function updateConfig(key: string, value: string): Promise<void> {
    const baseUrl = await getApiBase();
    const res = await fetch(`${baseUrl}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
    });

    if (!res.ok) {
        throw new Error("Failed to save config");
    }
}

export async function previewRename(original_path: string, selected_candidate: FileCandidate): Promise<string> {
    const baseUrl = await getApiBase();
    const res = await fetch(`${baseUrl}/preview_rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original_path, selected_candidate })
    });

    if (!res.ok) return "";
    const data = await res.json();
    return data.proposed_path;
}

export async function undoLastOperation(): Promise<{ success: boolean; message?: string; restored_count?: number }> {
    const baseUrl = await getApiBase();
    const res = await fetch(`${baseUrl}/undo`, {
        method: 'POST'
    });

    return res.json();
}

export async function getHistory(): Promise<any[]> {
    const baseUrl = await getApiBase();
    const res = await fetch(`${baseUrl}/history`);
    if (!res.ok) return [];
    return res.json();
}
