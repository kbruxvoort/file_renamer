import { invoke } from "@tauri-apps/api/core";

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
    parsed_title?: string | null;
    candidates: FileCandidate[];
    selected_index: number;
    proposed_path?: string | null;
    conflict?: boolean;
}

export interface ScanResponse {
    files: ScannedFile[];
    source_dir: string;
    dest_dir: string;
    warnings: string[];
}

export interface ScanProgress {
    phase: 'discovering' | 'matching' | 'done';
    total: number;
    done: number;
    cancelled: boolean;
}

export interface MoveRecord {
    src: string;
    dest: string;
    associated?: boolean;
}

export interface ExecuteResult {
    moved: MoveRecord[];
    errors: { file: string; error: string }[];
    skipped: { file: string; reason: string }[];
}

export interface ExecuteFile {
    original_path: string;
    selected_candidate: FileCandidate;
    proposed_path?: string | null;
}

export interface HistoryBatch {
    batch_id: string;
    timestamp: string;
    operations: MoveRecord[];
}

export interface UndoResult {
    success: boolean;
    message?: string | null;
    restored_count: number;
    failure_count: number;
    failures: { file: string; error: string }[];
}

export interface AppConfig {
    TMDB_API_KEY: string | null;
    DEST_DIR: string;
    MOVIE_DIR: string;
    TV_DIR: string;
    BOOK_DIR: string;
    AUDIOBOOK_DIR: string;
    SOURCE_DIR: string | null;
    MIN_VIDEO_SIZE_MB: number;
    MOVIE_TEMPLATE: string;
    TV_TEMPLATE: string;
    BOOK_TEMPLATE: string;
    AUDIOBOOK_TEMPLATE: string;
    DEFAULT_TEMPLATES: Record<string, string>;
}

export class ScanCancelledError extends Error {
    constructor() {
        super("Scan cancelled");
    }
}

// ============== Connection ==============

let apiBaseUrl: string | null = null;
let apiToken: string | null = null;

async function getApiBase(): Promise<string> {
    if (apiBaseUrl) return apiBaseUrl;

    try {
        const port = await invoke<number>("get_api_port");
        apiBaseUrl = `http://127.0.0.1:${port}`;
        apiToken = await invoke<string>("get_api_token");
    } catch (e) {
        console.warn("Failed to get dynamic port, falling back to default:", e);
        apiBaseUrl = "http://127.0.0.1:8742";
    }
    return apiBaseUrl;
}

/** fetch() against the backend, with the per-launch auth token attached. */
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const baseUrl = await getApiBase();
    const headers = new Headers(init.headers);
    if (apiToken) headers.set('X-Sortify-Token', apiToken);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function errorDetail(res: Response, fallback: string): Promise<string> {
    const body = await res.json().catch(() => null);
    return body?.detail || fallback;
}

async function postJson<T>(path: string, payload: unknown, fallbackError: string): Promise<T> {
    const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(await errorDetail(res, fallbackError));
    return res.json();
}

export async function checkHealth(): Promise<boolean> {
    try {
        const res = await apiFetch('/health');
        return res.ok;
    } catch {
        return false;
    }
}

/** Polls the backend until it answers (the sidecar takes a few seconds to start). */
export async function waitForBackend(timeoutMs = 30000, intervalMs = 500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await checkHealth()) return true;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return false;
}

export async function sendHeartbeat(): Promise<boolean> {
    try {
        const res = await apiFetch('/heartbeat', { method: 'POST' });
        return res.ok;
    } catch {
        return false;
    }
}

export async function shutdownBackend(): Promise<void> {
    try {
        await apiFetch('/shutdown', { method: 'POST' });
    } catch {
        // Expected - server shuts down before responding
    }
}

// ============== Scanning & matching ==============

export async function scanDirectory(paths: string[], scanId: string): Promise<ScanResponse> {
    const res = await apiFetch('/scan', {
        method: 'POST',
        body: JSON.stringify({ paths, min_size_mb: 0, scan_id: scanId }),
    });
    if (res.status === 409) throw new ScanCancelledError();
    if (!res.ok) throw new Error(await errorDetail(res, "Scan failed"));
    return res.json();
}

export async function getScanProgress(scanId: string): Promise<ScanProgress | null> {
    try {
        const res = await apiFetch(`/scan/${encodeURIComponent(scanId)}/progress`);
        return res.ok ? res.json() : null;
    } catch {
        return null;
    }
}

export async function cancelScan(scanId: string): Promise<void> {
    await apiFetch(`/scan/${encodeURIComponent(scanId)}/cancel`, { method: 'POST' });
}

export async function manualSearch(query: string, type: string): Promise<FileCandidate[]> {
    const data = await postJson<{ candidates: FileCandidate[] }>('/search', { query, type }, "Search failed");
    return data.candidates;
}

export async function previewRename(original_path: string, selected_candidate: FileCandidate): Promise<{ proposed_path: string; conflict: boolean }> {
    return postJson('/preview_rename', { original_path, selected_candidate }, "Preview failed");
}

export async function executeMoves(payload: { files: ExecuteFile[]; source_roots?: string[] }): Promise<ExecuteResult> {
    return postJson('/execute', payload, "Execute failed");
}

// ============== History ==============

export async function getHistory(): Promise<HistoryBatch[]> {
    const res = await apiFetch('/history');
    if (!res.ok) throw new Error(await errorDetail(res, "Failed to load history"));
    return res.json();
}

export async function undoBatch(batchId?: string): Promise<UndoResult> {
    return postJson('/undo', { batch_id: batchId ?? null }, "Undo failed");
}

// ============== Config ==============

export async function getConfig(reveal_keys: boolean = false): Promise<AppConfig> {
    const res = await apiFetch(`/config?reveal_keys=${reveal_keys}`);
    if (!res.ok) throw new Error("Failed to load config");
    return res.json();
}

/** Saves one setting. Resolves to a non-fatal warning (if any); throws with the server's reason on rejection. */
export async function updateConfig(key: string, value: string): Promise<string | null> {
    const data = await postJson<{ warning?: string | null }>('/config', { key, value }, "Failed to save config");
    return data.warning ?? null;
}

export async function templatePreview(template: string, type: string): Promise<{ path: string | null; error: string | null }> {
    return postJson('/template_preview', { template, type }, "Preview failed");
}
