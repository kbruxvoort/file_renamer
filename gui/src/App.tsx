import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { FilePicker } from './components/FilePicker';
import { type FileItem, fileStatus, isMovable, tailPath } from './types';
import { GroupedFileList, type FileFilter } from './components/GroupedFileList';
import { MatchSelectionModal } from './components/MatchSelectionModal';
import { SettingsPage } from './components/SettingsPage';
import { UpdateModal } from './components/UpdateModal';
import { ExecuteReviewModal } from './components/ExecuteReviewModal';
import { ExecuteResultModal } from './components/ExecuteResultModal';
import { HistoryModal } from './components/HistoryModal';
import { Toaster } from './components/Toaster';
import { toast } from './components/toast';
import {
  scanDirectory, previewRename, getConfig, getHistory, sendHeartbeat, waitForBackend,
  getScanProgress, cancelScan, executeMoves, ScanCancelledError,
  type FileCandidate, type ScannedFile, type ScanProgress, type ExecuteResult,
} from './api';
import {
  Loader2, Settings as SettingsIcon, Home, RefreshCw, FolderOpen, Play, History,
  ArrowUpCircle, PanelLeftClose, PanelLeftOpen, KeyRound, AlertTriangle, X,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { useUpdater } from './hooks/useUpdater';

type BackendStatus = 'connecting' | 'connected' | 'disconnected';

interface MatchSession {
  indices: number[];     // Files the choice applies to (more than one for "Change match" on a group)
  focus: number;         // File whose candidates are shown
  snapshot: Map<string, Pick<FileItem, 'candidates' | 'selected_index' | 'proposed_path' | 'conflict' | 'confirmed'>>;
}

const FILTERS: { key: FileFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'review', label: 'Needs review' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'ready', label: 'Ready' },
  { key: 'excluded', label: 'Excluded' },
];

/** Lowercase words only, for comparing titles parsed from different filenames. */
function normalizeTitle(t: string | null | undefined): string {
  return (t || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function toFileItem(f: ScannedFile): FileItem {
  // Auto-confirm logic based on title similarity
  let shouldAutoConfirm = false;

  if (f.candidates.length === 1) {
    shouldAutoConfirm = true; // Only one option
  } else if (f.candidates.length > 1) {
    // Multiple candidates - check if first is a confident match
    const firstCand = f.candidates[0];
    const fileTitle = normalizeTitle(f.parsed_title || f.filename.replace(/\.[^.]+$/, ''));
    const candTitle = normalizeTitle(firstCand.title);

    const titlesMatch = !!candTitle && !!fileTitle && (fileTitle.includes(candTitle) || candTitle.includes(fileTitle));

    // Same title, different years among the top candidates = ambiguous (The Office US/UK, One Piece)
    const isAmbiguous = f.candidates.slice(1, 5).some(other =>
      normalizeTitle(other.title) === candTitle && firstCand.year && other.year && firstCand.year !== other.year
    );

    shouldAutoConfirm = titlesMatch && !isAmbiguous;
  }

  return {
    original_path: f.original_path,
    filename: f.filename,
    file_type: f.file_type,
    parsed_title: f.parsed_title ?? null,
    candidates: f.candidates,
    selected_index: f.selected_index,
    proposed_path: f.proposed_path || null,
    conflict: !!f.conflict,
    confirmed: shouldAutoConfirm,
  };
}

function App() {
  // Navigation
  const [view, setView] = useState<'scanner' | 'settings'>('scanner');

  // UI State
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebarOpen');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try { localStorage.setItem('sidebarOpen', JSON.stringify(isSidebarOpen)); } catch { /* storage unavailable */ }
  }, [isSidebarOpen]);

  const [backendStatus, setBackendStatus] = useState<BackendStatus>('connecting');
  const [sourcePath, setSourcePath] = useState<string | null>(null); // Display Label
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]); // Actual paths
  const [defaultSource, setDefaultSource] = useState<string | null>(null);
  const [hasTmdbKey, setHasTmdbKey] = useState<boolean | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const [files, setFiles] = useState<FileItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [filter, setFilter] = useState<FileFilter>('all');

  // Long-running work
  const [scan, setScan] = useState<{ id: string; progress: ScanProgress | null } | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const busy = !!scan || isMoving;

  // Modals
  const [matchSession, setMatchSession] = useState<MatchSession | null>(null);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [isExecuteReviewOpen, setIsExecuteReviewOpen] = useState(false);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);

  // Updater
  const {
    status: updateStatus,
    updateAvailable,
    downloadProgress,
    checkUpdate,
    installUpdate,
    restartApp,
    needsRestart,
    mockUpdate,
    error: updateError
  } = useUpdater();
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  // ============== Backend connection ==============

  const refreshHistory = useCallback(() => {
    getHistory().then(hist => setHistoryCount(hist.length)).catch(() => setHistoryCount(0));
  }, []);

  const loadConfig = useCallback(() => {
    getConfig().then(cfg => {
      setDefaultSource(cfg.SOURCE_DIR || null);
      setHasTmdbKey(!!cfg.TMDB_API_KEY);
    }).catch(err => console.error("Failed to load config", err));
    refreshHistory();
  }, [refreshHistory]);

  const connect = useCallback(async () => {
    setBackendStatus('connecting');
    const ok = await waitForBackend();
    setBackendStatus(ok ? 'connected' : 'disconnected');
    if (ok) loadConfig();
  }, [loadConfig]);

  // Wait for the backend sidecar (it takes a few seconds to start) before loading anything
  useEffect(() => {
    connect();
  }, [connect]);

  // Heartbeat keeps the backend alive; two misses in a row = disconnected
  useEffect(() => {
    let misses = 0;
    const interval = setInterval(async () => {
      const ok = await sendHeartbeat();
      misses = ok ? 0 : misses + 1;
      setBackendStatus(prev => {
        if (ok) return 'connected';
        if (misses >= 2 && prev === 'connected') return 'disconnected';
        return prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error);
  }, []);

  // Reload config when switching back to scanner
  useEffect(() => {
    if (view === 'scanner' && backendStatus === 'connected') loadConfig();
  }, [view, backendStatus, loadConfig]);

  // ============== Scanning ==============

  const resetToHome = useCallback(() => {
    setFiles([]);
    setSourcePath(null);
    setSelectedPaths([]);
    setHasScanned(false);
    setScanWarnings([]);
    setFilter('all');
  }, []);

  const handleSelection = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;

    setView('scanner');
    setSelectedPaths(paths);
    setSourcePath(paths.length === 1 ? paths[0] : `${paths.length} items selected`);
    setError(null);
    setScanWarnings([]);
    setFiles([]);
    setFilter('all');
    setHasScanned(false);

    // randomUUID needs a secure context; fall back so scanning never breaks on it
    const scanId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setScan({ id: scanId, progress: null });

    // Poll progress while the scan request is in flight
    const poll = setInterval(async () => {
      const progress = await getScanProgress(scanId);
      if (progress) setScan(prev => prev && prev.id === scanId ? { ...prev, progress } : prev);
    }, 500);

    try {
      const result = await scanDirectory(paths, scanId);
      setFiles(result.files.map(toFileItem));
      setScanWarnings(result.warnings ?? []);
      setHasScanned(true);
    } catch (err) {
      if (err instanceof ScanCancelledError) {
        toast("Scan cancelled.");
        resetToHome();
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      clearInterval(poll);
      setScan(null);
    }
  }, [resetToHome]);

  // Drag and drop (registered once; handleSelection is stable)
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenDrop = win.listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
      setIsDragging(false);
      if (busyRef.current) {
        toast("Wait for the current scan or move to finish.");
        return;
      }
      if (event.payload?.paths?.length) handleSelection(event.payload.paths);
    });
    const unlistenEnter = win.listen('tauri://drag-enter', () => setIsDragging(true));
    const unlistenLeave = win.listen('tauri://drag-leave', () => setIsDragging(false));

    return () => {
      unlistenDrop.then(unlisten => unlisten());
      unlistenEnter.then(unlisten => unlisten());
      unlistenLeave.then(unlisten => unlisten());
    };
  }, [handleSelection]);

  async function handleCancelScan() {
    if (scan) await cancelScan(scan.id).catch(console.error);
  }

  // ============== File updates ==============

  /** Updates one file by path (indices can shift when files are removed). */
  const patchFile = useCallback((path: string, patch: Partial<FileItem>) => {
    setFiles(prev => prev.map(f => f.original_path === path ? { ...f, ...patch } : f));
  }, []);

  /**
   * Re-previews a file's destination for a candidate. The result is only stored if that
   * candidate is still the file's selection when it arrives: a slow preview for an
   * earlier pick (or one the user cancelled) must not overwrite the path that gets moved.
   */
  const refreshPreview = useCallback(async (path: string, candidate: FileCandidate) => {
    try {
      const preview = await previewRename(path, candidate);
      setFiles(prev => prev.map(f =>
        f.original_path === path && f.candidates[f.selected_index] === candidate
          ? { ...f, proposed_path: preview.proposed_path, conflict: preview.conflict }
          : f
      ));
    } catch (e) {
      toast(`Couldn't preview the new name: ${e instanceof Error ? e.message : e}`, 'error');
    }
  }, []);

  function handleRemoveFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  function handleSetExcluded(indices: number[], excluded: boolean) {
    const set = new Set(indices);
    setFiles(prev => prev.map((f, i) => set.has(i) ? { ...f, excluded } : f));
  }

  // ============== Match modal ==============

  function openMatch(indices: number[], focus = indices[0]) {
    const snapshot = new Map(indices.map(i => {
      const f = files[i];
      return [f.original_path, { candidates: f.candidates, selected_index: f.selected_index, proposed_path: f.proposed_path, conflict: f.conflict, confirmed: f.confirmed }] as const;
    }));
    setMatchSession({ indices, focus, snapshot });
  }

  const focusFile = matchSession ? files[matchSession.focus] : null;

  function closeMatch() {
    setMatchSession(null);
    setIsReviewMode(false);
  }

  /** X / Esc / backdrop: put back whatever was there when the modal opened. */
  function cancelMatch() {
    if (matchSession) {
      const { snapshot } = matchSession;
      setFiles(prev => prev.map(f => snapshot.has(f.original_path) ? { ...f, ...snapshot.get(f.original_path)! } : f));
    }
    closeMatch();
  }

  function handleCandidateSelect(candidateIndex: number) {
    if (!focusFile) return;
    const candidate = focusFile.candidates[candidateIndex];
    patchFile(focusFile.original_path, { selected_index: candidateIndex, proposed_path: null, conflict: false });
    if (candidate) refreshPreview(focusFile.original_path, candidate);
  }

  /** Results of a manual search replace the list; nothing is confirmed until the user picks. */
  function handleCandidatesUpdate(newCandidates: FileCandidate[]) {
    if (!focusFile) return;
    patchFile(focusFile.original_path, { candidates: newCandidates, selected_index: 0, confirmed: false, proposed_path: null, conflict: false });
    if (newCandidates.length > 0) refreshPreview(focusFile.original_path, newCandidates[0]);
  }

  /** Gives `target` the chosen candidate (adding it if the file doesn't have it yet). */
  function applyCandidate(target: FileItem, cand: FileCandidate): FileItem {
    let idx = target.candidates.findIndex(c => c.type === cand.type && (cand.id ? c.id === cand.id : c.title === cand.title));
    let candidates = target.candidates;
    if (idx === -1) {
      // Episode-specific fields belong to the source file, not this one
      const base: FileCandidate = { ...cand };
      delete base.episode_title;
      delete base.overview;
      candidates = [...candidates, base];
      idx = candidates.length - 1;
    }
    return { ...target, candidates, selected_index: idx, confirmed: true, proposed_path: null, conflict: false };
  }

  /**
   * After confirming a match, apply it to other files that are clearly the same
   * title: same media type, and either the same parsed title or the same folder
   * with no conflicting title. Files the user already confirmed are left alone.
   */
  function findSiblings(list: FileItem[], sourceIdx: number, cand: FileCandidate): number[] {
    const source = list[sourceIdx];
    const sourceTitle = normalizeTitle(source.parsed_title);
    const sourceDir = source.original_path.replace(/[/\\][^/\\]*$/, '');
    if (!cand.id && !cand.title) return [];

    return list.flatMap((f, idx) => {
      if (idx === sourceIdx || f.confirmed) return [];
      const fileType = f.candidates[f.selected_index]?.type ?? f.file_type;
      if (fileType !== cand.type) return [];

      const title = normalizeTitle(f.parsed_title);
      const sameTitle = sourceTitle.length >= 3 && title === sourceTitle;
      const sameDir = f.original_path.replace(/[/\\][^/\\]*$/, '') === sourceDir;
      const titleAgrees = !title || title === sourceTitle || title === normalizeTitle(cand.title);
      return sameTitle || (sameDir && titleAgrees) ? [idx] : [];
    });
  }

  async function handleConfirmSelection() {
    if (!matchSession || !focusFile) return;
    const selectedCand = focusFile.candidates[focusFile.selected_index];
    if (!selectedCand) return;

    const focusIdx = matchSession.focus;
    const updated = [...files];
    updated[focusIdx] = { ...updated[focusIdx], confirmed: true };

    // Group "Change match" applies to every file in the group; a single confirm spreads
    // to obvious siblings (other episodes of the same show)
    const targets = matchSession.indices.length > 1
      ? matchSession.indices.filter(i => i !== focusIdx)
      : findSiblings(updated, focusIdx, selectedCand);

    for (const i of targets) updated[i] = applyCandidate(updated[i], selectedCand);
    setFiles(updated);

    // Refresh destinations for everything that changed
    for (const i of targets) {
      const f = updated[i];
      refreshPreview(f.original_path, f.candidates[f.selected_index]);
    }
    if (targets.length > 0) {
      toast(`Applied "${selectedCand.title}" to ${targets.length} more file${targets.length !== 1 ? 's' : ''}.`, 'success');
    }

    if (isReviewMode) {
      const changed = new Set([focusIdx, ...targets]);
      const isOpenReview = (f: FileItem, idx: number) => !changed.has(idx) && fileStatus(f) === 'review';
      const next = updated.findIndex((f, idx) => idx > focusIdx && isOpenReview(f, idx));
      const anyNext = next !== -1 ? next : updated.findIndex(isOpenReview);
      if (anyNext !== -1) {
        openMatchFrom(updated, anyNext);
        return;
      }
    }
    closeMatch();
  }

  function openMatchFrom(list: FileItem[], index: number) {
    const f = list[index];
    setMatchSession({
      indices: [index],
      focus: index,
      snapshot: new Map([[f.original_path, { candidates: f.candidates, selected_index: f.selected_index, proposed_path: f.proposed_path, conflict: f.conflict, confirmed: f.confirmed }]]),
    });
  }

  function handleReviewUncertain() {
    const next = files.findIndex(f => fileStatus(f) === 'review');
    if (next === -1) {
      toast("No uncertain matches to review.");
      return;
    }
    setIsReviewMode(true);
    openMatchFrom(files, next);
  }

  function handleSkip() {
    if (!matchSession) return;
    const next = files.findIndex((f, idx) => idx > matchSession.focus && fileStatus(f) === 'review');
    if (next !== -1) openMatchFrom(files, next);
    else closeMatch();
  }

  function handleBack() {
    if (!matchSession) return;
    for (let i = matchSession.focus - 1; i >= 0; i--) {
      if (fileStatus(files[i]) === 'review') {
        openMatchFrom(files, i);
        return;
      }
    }
  }

  // ============== Derived ==============

  const statusCounts = useMemo(() => {
    const counts: Record<FileFilter, number> = { all: files.length, ready: 0, review: 0, unmatched: 0, excluded: 0 };
    for (const f of files) counts[fileStatus(f)]++;
    return counts;
  }, [files]);

  // Destinations shared by two or more files in this batch
  const duplicateTargets = useMemo(() => {
    const seen = new Map<string, number>();
    for (const f of files) {
      if (isMovable(f) && f.proposed_path) {
        const key = f.proposed_path.toLowerCase();
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    return new Set(files
      .filter(f => f.proposed_path && (seen.get(f.proposed_path.toLowerCase()) ?? 0) > 1)
      .map(f => f.proposed_path!));
  }, [files]);

  // Count unique groups that need review (by candidate ID or title), not individual files
  const uncertainCount = useMemo(() => {
    const groups = new Set<string>();
    files.forEach(f => {
      if (fileStatus(f) === 'review') {
        const cand = f.candidates[f.selected_index];
        groups.add(cand?.id ? `id:${cand.id}` : cand?.title ? `title:${cand.title}` : `file:${f.original_path}`);
      }
    });
    return groups.size;
  }, [files]);

  const movableCount = files.filter(isMovable).length;

  // ============== Execute ==============

  async function handleExecute() {
    setIsExecuteReviewOpen(false);
    const toMove = files.filter(isMovable);
    if (toMove.length === 0) return;

    setIsMoving(true);
    try {
      const result = await executeMoves({
        files: toMove.map(f => ({
          original_path: f.original_path,
          selected_candidate: f.candidates[f.selected_index],
          proposed_path: f.proposed_path,
        })),
        source_roots: selectedPaths,
      });

      // Keep anything that didn't move (failed, unmatched, excluded) so it can be fixed and retried
      const movedPaths = new Set(result.moved.filter(m => !m.associated).map(m => m.src));
      const remaining = files.filter(f => !movedPaths.has(f.original_path));
      setFiles(remaining);
      if (remaining.length === 0) resetToHome();

      setExecuteResult(result);
      refreshHistory();
    } catch (err) {
      setError("Failed to move files: " + (err instanceof Error ? err.message : err));
    } finally {
      setIsMoving(false);
    }
  }

  // ============== Render ==============

  const progress = scan?.progress;
  const progressPct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <div className="h-screen w-full bg-gray-900 text-white font-sans flex overflow-hidden">
      <Toaster />

      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-blue-500/20 backdrop-blur-sm flex items-center justify-center border-4 border-blue-500 border-dashed m-4 rounded-xl pointer-events-none">
          <div className="text-2xl font-bold text-blue-200">
            {busy ? "Busy - wait for the current task" : "Drop folders or files to scan"}
          </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside
        className={clsx(
          "flex-none h-full border-r border-gray-800 flex flex-col gap-6 bg-gray-900/50 backdrop-blur-sm z-10 transition-all duration-300 relative",
          isSidebarOpen ? "w-64 p-6" : "w-20 p-4 items-center"
        )}
      >
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute -right-3 top-8 bg-gray-800 text-gray-400 hover:text-white rounded-full p-1 border border-gray-700 shadow-lg z-50 hover:bg-gray-700 transition-colors"
          aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {isSidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>

        <div className={clsx("flex items-center gap-3", isSidebarOpen ? "px-2" : "justify-center")}>
          <img src="/icon.png" alt="Logo" className="w-8 h-8 rounded-lg shrink-0" />
          {isSidebarOpen && <h1 className="text-xl font-bold tracking-tight whitespace-nowrap">Sortify</h1>}
        </div>

        <nav className="flex-1 space-y-1 w-full">
          {([
            { key: 'scanner', label: 'Scanner', Icon: Home },
            { key: 'settings', label: 'Settings', Icon: SettingsIcon },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                !isSidebarOpen && "justify-center",
                view === key ? "bg-blue-600/10 text-blue-400" : "text-gray-400 hover:bg-gray-800 hover:text-gray-100"
              )}
              title={label}
              aria-current={view === key ? 'page' : undefined}
            >
              <Icon size={18} className="shrink-0" />
              {isSidebarOpen && <span>{label}</span>}
            </button>
          ))}
          <button
            onClick={() => setIsHistoryOpen(true)}
            disabled={backendStatus !== 'connected'}
            className={clsx(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-gray-400 hover:bg-gray-800 hover:text-gray-100 disabled:opacity-50",
              !isSidebarOpen && "justify-center",
            )}
            title="History & undo"
          >
            <History size={18} className="shrink-0" />
            {isSidebarOpen && <span className="flex-1 text-left">History</span>}
            {isSidebarOpen && historyCount > 0 && <span className="text-xs text-gray-500">{historyCount}</span>}
          </button>
        </nav>

        <div className={clsx("pt-6 border-t border-gray-800 space-y-4 w-full", !isSidebarOpen && "flex flex-col items-center")}>
          <div className={clsx("flex flex-col gap-1", isSidebarOpen ? "px-2" : "items-center")}>
            <div
              className={clsx("flex items-center gap-2 text-xs text-gray-500", !isSidebarOpen && "justify-center")}
              title={`Backend ${backendStatus}`}
            >
              <span className={clsx(
                "w-2 h-2 rounded-full shrink-0",
                backendStatus === 'connected' && "bg-green-500",
                backendStatus === 'connecting' && "bg-yellow-500 animate-pulse",
                backendStatus === 'disconnected' && "bg-red-500",
              )}></span>
              {isSidebarOpen && (backendStatus === 'connected' ? "Backend ready" : backendStatus === 'connecting' ? "Starting backend..." : "Backend offline")}
            </div>

            {appVersion && (
              <button
                className={clsx(
                  "text-[10px] text-gray-600 font-mono hover:text-blue-400 transition-colors text-left",
                  !isSidebarOpen && "text-center w-full"
                )}
                onClick={() => {
                  if (updateStatus === 'idle' || updateStatus === 'error' || updateStatus === 'up-to-date') {
                    checkUpdate();
                  }
                }}
                title={`v${appVersion} - Click to check for updates`}
              >
                v{appVersion}
                {isSidebarOpen && updateStatus === 'checking' && ' · checking...'}
                {isSidebarOpen && updateStatus === 'up-to-date' && ' · up to date'}
              </button>
            )}

            {(updateStatus === 'available' || (updateStatus === 'error' && updateAvailable)) && (
              <button
                onClick={() => setIsUpdateModalOpen(true)}
                className={clsx(
                  "mt-2 w-full flex items-center gap-2 px-3 py-2 bg-blue-600/20 text-blue-400 rounded-lg text-xs font-bold border border-blue-600/50 hover:bg-blue-600/30 transition-all",
                  updateStatus === 'available' && "animate-pulse",
                  !isSidebarOpen && "justify-center px-2"
                )}
                title="Update Available"
              >
                <ArrowUpCircle size={14} className="shrink-0" />
                {isSidebarOpen && "Update Available"}
              </button>
            )}

            {/* Dev/Mock Trigger (Hidden in Prod) */}
            {import.meta.env.DEV && (
              <button
                onClick={mockUpdate}
                className={clsx(
                  "mt-4 text-[10px] text-gray-700 hover:text-gray-500 uppercase tracking-widest text-center w-full",
                  !isSidebarOpen && "hidden"
                )}
              >
                Test Update UI
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-y-auto p-8 relative transition-all">
        {view === 'settings' ? (
          <SettingsPage onSaved={loadConfig} />
        ) : backendStatus !== 'connected' && !hasScanned ? (
          <div className="flex flex-col items-center justify-center py-32 text-gray-400 gap-4">
            {backendStatus === 'connecting' ? (
              <>
                <Loader2 className="animate-spin text-blue-500" size={40} />
                <p className="text-lg text-gray-300">Starting Sortify...</p>
              </>
            ) : (
              <>
                <AlertTriangle className="text-red-400" size={40} />
                <p className="text-lg text-gray-300">Can't reach the Sortify backend.</p>
                <p className="text-sm max-w-md text-center">It may have crashed or been blocked by antivirus. Check the log at <code className="text-gray-300">~/.renamer/renamer.log</code>.</p>
                <button onClick={connect} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm">Try again</button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">

            {/* First run: no TMDB key */}
            {hasTmdbKey === false && !scan && (
              <div className="p-4 rounded-xl bg-blue-900/20 border border-blue-800/50 flex items-center gap-4">
                <KeyRound className="text-blue-400 shrink-0" size={22} />
                <div className="flex-1 text-sm">
                  <p className="text-blue-100 font-medium">Add your TMDB API key to match movies and TV shows.</p>
                  <p className="text-blue-200/70">Without it, video files can't be identified. Books and audiobooks still work.</p>
                </div>
                <button onClick={() => setView('settings')} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium">Open Settings</button>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="p-4 rounded-lg bg-red-900/20 border border-red-800 text-red-200 flex justify-between items-center gap-4" role="alert">
                <span>Error: {error}</span>
                <button onClick={() => setError(null)} className="px-3 py-1 bg-red-900/50 hover:bg-red-900/80 rounded text-sm">Dismiss</button>
              </div>
            )}

            {/* Initial Empty State / Scanner controls */}
            {!busy && !hasScanned && (
              <div className="flex flex-col items-center justify-center py-20 bg-gray-800/30 border border-gray-700/50 rounded-3xl border-dashed relative">
                {historyCount > 0 && (
                  <button
                    onClick={() => setIsHistoryOpen(true)}
                    className="absolute top-4 right-4 flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 rounded-xl text-sm font-medium border border-yellow-500/20 transition-colors"
                  >
                    <History size={16} />
                    History & Undo
                  </button>
                )}

                <div className="bg-gray-800 p-4 rounded-full mb-6">
                  <FolderOpen size={48} className="text-blue-400" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Scan Your Media</h2>
                <p className="text-gray-400 mb-8 text-center max-w-md">
                  Drag and drop folders or files here, or pick a source.<br />Nothing moves until you review and confirm.
                </p>

                <div className="flex flex-col gap-3 w-full max-w-sm">
                  {defaultSource && (
                    <button
                      onClick={() => handleSelection([defaultSource])}
                      className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors shadow-lg shadow-blue-900/20 w-full"
                    >
                      <Play size={20} fill="currentColor" />
                      Scan Default
                    </button>
                  )}

                  <FilePicker
                    onPathSelect={handleSelection}
                    type="folder"
                    label="Browse Folder..."
                  />
                  <FilePicker
                    onPathSelect={handleSelection}
                    type="file"
                    label="Select Files..."
                  />
                </div>

                {defaultSource && (
                  <p className="mt-4 text-xs text-gray-500 font-mono">
                    Default: {defaultSource}
                  </p>
                )}
              </div>
            )}

            {/* Scan progress */}
            {scan && (
              <div className="flex flex-col items-center justify-center py-28 text-gray-400">
                <Loader2 className="animate-spin mb-4 text-blue-500" size={48} />
                <p className="text-lg font-medium text-gray-300">
                  {!progress || progress.phase === 'discovering' ? 'Finding media files...' : `Matching ${progress.done} of ${progress.total} files`}
                </p>
                <p className="text-sm font-mono mt-1 truncate max-w-lg">{sourcePath}</p>
                <div className="w-80 h-2 bg-gray-800 rounded-full overflow-hidden mt-6" role="progressbar" aria-valuenow={progressPct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className={clsx("h-full bg-blue-500 transition-all duration-300", progressPct === null && "w-1/3 animate-pulse")}
                    style={progressPct !== null ? { width: `${progressPct}%` } : undefined}
                  />
                </div>
                <button onClick={handleCancelScan} disabled={progress?.cancelled} className="mt-6 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-sm text-gray-200">
                  {progress?.cancelled ? 'Cancelling...' : 'Cancel'}
                </button>
              </div>
            )}

            {/* Moving */}
            {isMoving && (
              <div className="flex flex-col items-center justify-center py-32 text-gray-400">
                <Loader2 className="animate-spin mb-4 text-blue-500" size={48} />
                <p className="text-lg font-medium text-gray-300">Moving {movableCount} files...</p>
                <p className="text-sm">Large files on network drives can take a while.</p>
              </div>
            )}

            {/* No Files Found State */}
            {!busy && hasScanned && files.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 bg-gray-800/30 border border-gray-700/50 rounded-3xl border-dashed">
                <div className="bg-gray-800 p-4 rounded-full mb-6">
                  <FolderOpen size={48} className="text-gray-500" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">No Files Found</h2>
                <p className="text-gray-400 mb-8 text-center max-w-md">
                  We couldn't find any media files to reorganize in the selected location.
                </p>
                <button onClick={resetToHome} className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors">
                  Go Back
                </button>
              </div>
            )}

            {/* Results */}
            {!busy && files.length > 0 && (
              <section className="animate-fade-in space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <h2 className="text-xl font-bold shrink-0">Scan Results</h2>
                    <div className="h-6 w-px bg-gray-700 block shrink-0"></div>
                    <div className="text-sm text-gray-400 font-mono truncate" title={sourcePath || undefined}>{sourcePath && tailPath(sourcePath, 3)}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => selectedPaths.length > 0 && handleSelection(selectedPaths)}
                      className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                      title="Rescan"
                      aria-label="Rescan"
                    >
                      <RefreshCw size={20} />
                    </button>
                    <button
                      onClick={resetToHome}
                      className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                      title="Close results"
                      aria-label="Close results"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                {scanWarnings.length > 0 && (
                  <div className="p-3 rounded-lg bg-yellow-900/20 border border-yellow-800/50 text-sm text-yellow-100 flex gap-3" role="alert">
                    <AlertTriangle size={18} className="text-yellow-400 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      {scanWarnings.map(w => <p key={w}>{w}</p>)}
                    </div>
                    {scanWarnings.some(w => w.includes('API key')) && (
                      <button onClick={() => setView('settings')} className="self-start px-3 py-1 rounded bg-yellow-700/40 hover:bg-yellow-700/60 text-xs">Settings</button>
                    )}
                  </div>
                )}

                <div className="p-4 bg-blue-900/10 border border-blue-900/30 rounded-xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="text-blue-200 text-sm">
                      <strong>{movableCount}</strong> of {files.length} files will be moved.
                    </div>
                    {uncertainCount > 0 && (
                      <button
                        onClick={handleReviewUncertain}
                        className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30 rounded-lg text-xs font-medium border border-yellow-500/30 transition-colors"
                      >
                        <RefreshCw size={14} />
                        Review {uncertainCount} Uncertain
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setIsExecuteReviewOpen(true)}
                    disabled={movableCount === 0}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-blue-900/20"
                  >
                    Review & Move
                  </button>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter files">
                  {FILTERS.map(({ key, label }) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={filter === key}
                      onClick={() => setFilter(key)}
                      disabled={key !== 'all' && statusCounts[key] === 0}
                      className={clsx(
                        "px-3 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-40",
                        filter === key ? "bg-blue-600/20 text-blue-200 border-blue-600/50" : "bg-gray-800/50 text-gray-400 border-gray-700 hover:text-gray-200",
                      )}
                    >
                      {label} <span className="text-gray-500">{statusCounts[key]}</span>
                    </button>
                  ))}
                </div>

                <GroupedFileList
                  files={files}
                  filter={filter}
                  duplicateTargets={duplicateTargets}
                  onRowClick={(i) => openMatch([i])}
                  onRemove={handleRemoveFile}
                  onSetExcluded={handleSetExcluded}
                  onChangeGroupMatch={(indices) => openMatch(indices)}
                />
              </section>
            )}
          </div>
        )}

        <MatchSelectionModal
          isOpen={!!focusFile}
          onCancel={cancelMatch}
          filename={focusFile?.filename || ''}
          parsedTitle={focusFile?.parsed_title}
          fileType={focusFile?.file_type}
          candidates={focusFile?.candidates || []}
          selectedIndex={focusFile?.selected_index || 0}
          proposedPath={focusFile?.proposed_path}
          conflict={focusFile?.conflict}
          groupSize={matchSession?.indices.length ?? 1}
          onUpdateCandidates={handleCandidatesUpdate}
          onSelect={handleCandidateSelect}
          onConfirm={handleConfirmSelection}
          onSkip={isReviewMode ? handleSkip : undefined}
          onBack={isReviewMode ? handleBack : undefined}
        />

        <ExecuteReviewModal
          isOpen={isExecuteReviewOpen}
          files={files}
          duplicateTargets={duplicateTargets}
          onClose={() => setIsExecuteReviewOpen(false)}
          onConfirm={handleExecute}
        />

        <ExecuteResultModal result={executeResult} onClose={() => setExecuteResult(null)} />

        <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} onUndone={refreshHistory} />

        <UpdateModal
          isOpen={isUpdateModalOpen}
          onClose={() => setIsUpdateModalOpen(false)}
          update={updateAvailable}
          status={updateStatus}
          progress={downloadProgress}
          error={updateError}
          needsRestart={needsRestart}
          onRestart={restartApp}
          onConfirm={installUpdate}
        />
      </main>
    </div>
  );
}

export default App;
