import { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { FilePicker } from './components/FilePicker';
import { type FileItem } from './types';
import { GroupedFileList } from './components/GroupedFileList';
import { MatchSelectionModal } from './components/MatchSelectionModal';
import { SettingsPage } from './components/SettingsPage';
import { UpdateModal } from './components/UpdateModal';
import { UndoPreviewModal } from './components/UndoPreviewModal'; // New
import { scanDirectory, previewRename, getConfig, undoLastOperation, getHistory, sendHeartbeat, type FileCandidate } from './api';
import { Loader2, Settings as SettingsIcon, Home, RefreshCw, FolderOpen, Play, RotateCcw, ArrowUpCircle, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { useUpdater } from './hooks/useUpdater';

function App() {
  // Navigation
  const [view, setView] = useState<'scanner' | 'settings'>('scanner');

  // UI State
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebarOpen');
    return saved !== null ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    localStorage.setItem('sidebarOpen', JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  const [sourcePath, setSourcePath] = useState<string | null>(null); // Display Label
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]); // Actual paths
  const [defaultSource, setDefaultSource] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const [files, setFiles] = useState<FileItem[]>([]);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  // Modal state
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null);

  // Undo state
  const [hasHistory, setHasHistory] = useState(false);
  const [isUndoModalOpen, setIsUndoModalOpen] = useState(false);
  const [undoBatch, setUndoBatch] = useState<any>(null);
  const [isUndoing, setIsUndoing] = useState(false);

  // Updater
  const {
    status: updateStatus,
    updateAvailable,
    downloadProgress,
    checkUpdate,
    installUpdate,
    mockUpdate,
    error: updateError
  } = useUpdater();

  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  // Open modal when update becomes available (optional auto-open)
  useEffect(() => {
    if (updateStatus === 'available') {
      // setIsUpdateModalOpen(true); // Uncomment to auto-open
    }
  }, [updateStatus]);

  // Load config helper
  const loadConfig = () => {
    getConfig().then(cfg => {
      if (cfg.SOURCE_DIR) {
        setDefaultSource(cfg.SOURCE_DIR);
      } else {
        setDefaultSource(null);
      }
    }).catch(console.error);

    // Check history
    getHistory().then((hist: any[]) => setHasHistory(hist.length > 0));
  };

  // Initial load
  useEffect(() => {
    loadConfig();

    // Setup drag and drop
    const unlistenPromise = getCurrentWindow().listen('tauri://drag-drop', (event: any) => {
      // payload is { paths: string[], position: { x, y } }
      if (event.payload?.paths?.length > 0) {
        handleSelection(event.payload.paths);
      }
      setIsDragging(false);
    });

    const unlistenEnter = getCurrentWindow().listen('tauri://drag-enter', () => setIsDragging(true));
    const unlistenLeave = getCurrentWindow().listen('tauri://drag-leave', () => setIsDragging(false));

    return () => {
      unlistenPromise.then(unlisten => unlisten());
      unlistenEnter.then(unlisten => unlisten());
      unlistenLeave.then(unlisten => unlisten());
    };
  }, []);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error);
  }, []);

  // Heartbeat
  useEffect(() => {
    const interval = setInterval(() => {
      sendHeartbeat();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Reload config when switching back to scanner
  useEffect(() => {
    if (view === 'scanner') {
      loadConfig();
    }
  }, [view]);

  async function handleSelection(paths: string[]) {
    if (paths.length === 0) return;

    setSelectedPaths(paths);

    // Update display label
    if (paths.length === 1) {
      setSourcePath(paths[0]);
    } else {
      setSourcePath(`${paths.length} items selected`);
    }

    setLoadingMessage("Scanning directory...");
    setError(null);
    setFiles([]);
    setHasScanned(false);

    try {
      const result = await scanDirectory(paths);
      const uiFiles: FileItem[] = result.files.map(f => {
        // Auto-confirm logic based on title similarity
        let shouldAutoConfirm = false;

        if (f.candidates.length === 0) {
          shouldAutoConfirm = false; // No match
        } else if (f.candidates.length === 1) {
          shouldAutoConfirm = true; // Only one option
        } else {
          // Multiple candidates - check if first is a confident match
          const firstCand = f.candidates[0];

          // Extract title from filename for comparison
          const filenameLower = f.filename.toLowerCase()
            .replace(/\.[^.]+$/, '') // Remove extension
            .replace(/[._-]/g, ' ') // Normalize separators
            .replace(/\b[sS]\d{1,2}[eE]\d{1,3}\b/g, '') // Remove S01E02
            .replace(/\b\d{1,2}[xX]\d{1,3}\b/g, '') // Remove 1x01
            .replace(/\b(19|20)\d{2}\b/g, '') // Remove years
            .replace(/\s+/g, ' ')
            .trim();

          const candTitleLower = (firstCand.title || '').toLowerCase();

          // Check if there's a strong title match
          const titlesMatch =
            filenameLower.includes(candTitleLower) ||
            candTitleLower.includes(filenameLower.split(' ').slice(0, 3).join(' '));

          // Detect ambiguous same-title variants (One Piece anime/live, The Office US/UK)
          // Check if any of the top candidates share similar base title but different years
          const normalizeTitle = (t: string) => t.toLowerCase()
            .replace(/^the\s+/i, '') // Remove leading "the"
            .replace(/\s+/g, ' ')
            .trim();

          const firstTitleNorm = normalizeTitle(firstCand.title || '');
          let isAmbiguous = false;

          for (let i = 1; i < Math.min(f.candidates.length, 5); i++) {
            const otherCand = f.candidates[i];
            const otherTitleNorm = normalizeTitle(otherCand.title || '');

            // Similar title but different year = ambiguous (like The Office 2005 vs 2001)
            if (firstTitleNorm === otherTitleNorm &&
              firstCand.year && otherCand.year &&
              firstCand.year !== otherCand.year) {
              isAmbiguous = true;
              break;
            }
          }

          // Auto-confirm if titles match AND not ambiguous variants
          shouldAutoConfirm = titlesMatch && !isAmbiguous;
        }

        return {
          original_path: f.original_path,
          filename: f.filename,
          file_type: f.file_type,
          candidates: f.candidates,
          selected_index: f.selected_index,
          proposed_path: f.proposed_path || null,
          confirmed: shouldAutoConfirm
        };
      });
      setFiles(uiFiles);
      setHasScanned(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingMessage(null);
    }
  }

  function handleRowClick(index: number) {
    setSelectedFileIndex(index);
  }

  const [isReviewMode, setIsReviewMode] = useState(false);

  async function handleCandidateSelect(candidateIndex: number) {
    if (selectedFileIndex === null) return;

    // Optimistically update selection
    setFiles(prev => prev.map((file, idx) => {
      if (idx !== selectedFileIndex) return file;
      return {
        ...file,
        selected_index: candidateIndex,
      };
    }));

    // Fetch new path
    const file = files[selectedFileIndex];
    const candidate = file.candidates[candidateIndex];

    if (candidate) {
      try {
        const newPath = await previewRename(file.original_path, candidate);
        setFiles(prev => prev.map((f, idx) => {
          if (idx !== selectedFileIndex) return f;
          return { ...f, proposed_path: newPath };
        }));
      } catch (e) {
        console.error("Failed to preview rename", e);
      }
    }
  }

  // In-place variant: mutates filesToUpdate directly, doesn't call setFiles
  async function propagateMatchToFolderInPlace(
    sourceIndex: number,
    sourceCand: FileCandidate,
    filesToUpdate: FileItem[]
  ): Promise<number[]> {
    if (!sourceCand?.id) return [];
    const sourceFile = filesToUpdate[sourceIndex];
    if (!sourceFile) return [];

    function extractTitleFromPath(filePath: string): string {
      const platformSep = filePath.includes('\\') ? '\\' : '/';
      const filename = filePath.split(platformSep).pop() || '';
      return filename.replace(/\.[^.]+$/, '')
        .replace(/[._-]/g, ' ')
        .replace(/\b[Ss]\d{1,2}[Ee]\d{1,3}\b/g, '')
        .replace(/\b\d{1,2}[xX]\d{1,3}\b/g, '')
        .replace(/\b(19|20)\d{2}\b/g, '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const sourceTitle = extractTitleFromPath(sourceFile.original_path);
    const matchedTitle = sourceCand.title?.toLowerCase() || '';
    const updates: { index: number; candidateIndex: number }[] = [];

    filesToUpdate.forEach((f, idx) => {
      if (idx === sourceIndex) return;
      const fileTitle = extractTitleFromPath(f.original_path);
      const titlesMatch = fileTitle && sourceTitle && (
        fileTitle.startsWith(sourceTitle) || sourceTitle.startsWith(fileTitle) ||
        fileTitle.includes(matchedTitle.split(' ').slice(0, 2).join(' ')) ||
        (matchedTitle && fileTitle.includes(matchedTitle))
      );

      if (!titlesMatch) return;

      let candIdx = f.candidates.findIndex(c => c.id === sourceCand.id);
      if (candIdx === -1 && sourceCand.title) {
        candIdx = f.candidates.findIndex(c => c.title?.toLowerCase() === sourceCand.title?.toLowerCase());
      }

      if (candIdx === -1) {
        const { episode_title, overview, ...baseCand } = sourceCand as any;
        filesToUpdate[idx] = { ...filesToUpdate[idx], candidates: [...f.candidates, { ...baseCand }] };
        candIdx = filesToUpdate[idx].candidates.length - 1;
      }

      // Add update if:
      // 1. Found a matching candidate AND
      // 2. Either not already confirmed, OR not at the correct index
      const needsUpdate = candIdx !== -1 && (
        !filesToUpdate[idx].confirmed ||
        candIdx !== filesToUpdate[idx].selected_index
      );

      if (needsUpdate) {
        updates.push({ index: idx, candidateIndex: candIdx });
      }
    });

    if (updates.length > 0) {
      await Promise.all(updates.map(async (up) => {
        filesToUpdate[up.index] = { ...filesToUpdate[up.index], selected_index: up.candidateIndex, confirmed: true };
        try {
          const cand = filesToUpdate[up.index].candidates[up.candidateIndex];
          const p = await previewRename(filesToUpdate[up.index].original_path, cand);
          if (p) filesToUpdate[up.index] = { ...filesToUpdate[up.index], proposed_path: p };
        } catch (e) { console.error(e); }
      }));
      return updates.map(u => u.index);
    }
    return [];
  }

  async function handleConfirmSelection() {
    if (selectedFileIndex === null) return;

    const currentFile = files[selectedFileIndex];
    if (!currentFile) return;

    const selectedCand = currentFile.candidates[currentFile.selected_index];
    const currentIdx = selectedFileIndex;

    let propagatedIndices: number[] = [];
    let updatedFiles = [...files];

    // First, mark current file as confirmed in our local copy
    updatedFiles[currentIdx] = { ...updatedFiles[currentIdx], confirmed: true };

    // Then propagate to related files (propagation will update updatedFiles in-place)
    if (selectedCand?.id) {
      propagatedIndices = await propagateMatchToFolderInPlace(currentIdx, selectedCand, updatedFiles);
    }

    // Single state update with all changes
    setFiles(updatedFiles);

    if (isReviewMode) {
      // Find next uncertain using updatedFiles (not stale state)
      const nextUncertain = updatedFiles.findIndex((f, idx) =>
        idx > selectedFileIndex &&
        !f.confirmed &&
        !propagatedIndices.includes(idx) &&
        f.candidates.length > 1
      );

      if (nextUncertain !== -1) {
        setSelectedFileIndex(nextUncertain);
      } else {
        const anyUncertain = updatedFiles.findIndex((f, idx) =>
          !f.confirmed &&
          !propagatedIndices.includes(idx) &&
          idx !== selectedFileIndex &&
          f.candidates.length > 1
        );

        if (anyUncertain !== -1) {
          setSelectedFileIndex(anyUncertain);
        } else {
          setIsReviewMode(false);
          setSelectedFileIndex(null);
        }
      }
    } else {
      setSelectedFileIndex(null);
    }
  }

  async function handleCandidatesUpdate(newCandidates: FileCandidate[]) {
    if (selectedFileIndex === null) return;

    const file = files[selectedFileIndex];
    let newPath = file.proposed_path;

    if (newCandidates.length > 0) {
      try {
        newPath = await previewRename(file.original_path, newCandidates[0]);
      } catch (e) {
        console.error("Failed to preview new candidate", e);
      }
    }

    setFiles(prev => prev.map((f, idx) => {
      if (idx !== selectedFileIndex) return f;
      return {
        ...f,
        candidates: newCandidates,
        selected_index: 0,
        confirmed: true,
        proposed_path: newPath
      };
    }));
  }

  function handleReviewUncertain() {
    setIsReviewMode(true);
    const nextUncertain = files.findIndex((f) =>
      !f.confirmed && f.candidates.length > 1
    );

    if (nextUncertain !== -1) {
      setSelectedFileIndex(nextUncertain);
    } else {
      alert("No uncertain matches to review!");
      setIsReviewMode(false);
    }
  }

  function handleRemoveFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function handleMoveAll() {
    if (files.length === 0) return;

    setLoadingMessage("Moving files... This may take a moment for large libraries.");

    const payload = {
      files: files.map(f => ({
        original_path: f.original_path,
        selected_candidate: f.candidates[f.selected_index] || null
      }))
    };

    try {
      const { executeMoves } = await import('./api');
      const result = await executeMoves(payload);

      // Refresh history immediately
      getHistory().then((hist: any[]) => setHasHistory(hist.length > 0));

      alert(`Moved ${result.moved.length} files. ${result.errors.length} errors.`);

      if (selectedPaths.length > 0) {
        // If user explicitly selected files, maybe ask if they want to clear or rescan?
        // For now, let's just clear to show success + undo option
        setFiles([]);
        setLoadingMessage(null);
        setHasScanned(false);
        setSourcePath(null); // Reset title
        setSelectedPaths([]); // Reset selection
      } else {
        setFiles([]);
        setLoadingMessage(null);
        setHasScanned(false);
      }

    } catch (err: any) {
      setError("Failed to move files: " + err.message);
      setLoadingMessage(null);
    }
  }

  function handleSkip() {
    if (selectedFileIndex === null) return;
    const nextUncertain = files.findIndex((f, idx) =>
      idx > selectedFileIndex && !f.confirmed && f.candidates.length > 1
    );

    if (nextUncertain !== -1) {
      setSelectedFileIndex(nextUncertain);
    } else {
      setIsReviewMode(false);
      setSelectedFileIndex(null);
    }
  }

  function handleBack() {
    if (selectedFileIndex === null) return;
    let prevUncertain = -1;
    for (let i = selectedFileIndex - 1; i >= 0; i--) {
      if (!files[i].confirmed && files[i].candidates.length > 1) {
        prevUncertain = i;
        break;
      }
    }

    if (prevUncertain !== -1) {
      setSelectedFileIndex(prevUncertain);
    }
  }

  const selectedFile = selectedFileIndex !== null ? files[selectedFileIndex] : null;

  // Count unique groups that need review (by candidate ID or title), not individual files
  const uncertainGroups = new Set<string>();
  files.forEach(f => {
    if (!f.confirmed && f.candidates.length > 1) {
      const cand = f.candidates[f.selected_index];
      const groupKey = cand?.id ? `id:${cand.id}` : cand?.title ? `title:${cand.title}` : `file:${f.original_path}`;
      uncertainGroups.add(groupKey);
    }
  });
  const uncertainCount = uncertainGroups.size;

  async function handleUndoClick() {
    try {
      const hist = await getHistory();
      if (hist && hist.length > 0) {
        setUndoBatch(hist[0]); // Get latest batch
        setIsUndoModalOpen(true);
      } else {
        alert("No history found to undo.");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to load history.");
    }
  }

  async function confirmUndo() {
    setIsUndoing(true);
    try {
      const result = await undoLastOperation();
      if (result.success) {
        alert(`Undo Successful! Restored ${result.restored_count} files.`);

        // Reset state clearly
        setFiles([]);
        setSourcePath(null);
        setSelectedPaths([]);
        setHasScanned(false);
        setIsUndoModalOpen(false);

        // Re-check info
        getHistory().then((hist: any[]) => setHasHistory(hist.length > 0));

      } else {
        alert(`Undo Failed: ${result.message}`);
      }
    } catch (e: any) {
      alert("Undo failed: " + e.message);
    } finally {
      setIsUndoing(false);
    }
  }

  return (
    <div className="h-screen w-full bg-gray-900 text-white font-sans flex overflow-hidden">
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-blue-500/20 backdrop-blur-sm flex items-center justify-center border-4 border-blue-500 border-dashed m-4 rounded-xl">
          <div className="text-2xl font-bold text-blue-200 pointer-events-none">
            Drop folder to scan
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
        >
          {isSidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>

        <div className={clsx("flex items-center gap-3", isSidebarOpen ? "px-2" : "justify-center")}>
          <img src="/icon.png" alt="Logo" className="w-8 h-8 rounded-lg shrink-0" />
          {isSidebarOpen && <h1 className="text-xl font-bold tracking-tight whitespace-nowrap">Sortify</h1>}
        </div>

        <nav className="flex-1 space-y-1 w-full">
          <button
            onClick={() => setView('scanner')}
            className={clsx(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              !isSidebarOpen && "justify-center",
              view === 'scanner' ? "bg-blue-600/10 text-blue-400" : "text-gray-400 hover:bg-gray-800 hover:text-gray-100"
            )}
            title="Scanner"
          >
            <Home size={18} className="shrink-0" />
            {isSidebarOpen && <span>Scanner</span>}
          </button>
          <button
            onClick={() => setView('settings')}
            className={clsx(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              !isSidebarOpen && "justify-center",
              view === 'settings' ? "bg-blue-600/10 text-blue-400" : "text-gray-400 hover:bg-gray-800 hover:text-gray-100"
            )}
            title="Settings"
          >
            <SettingsIcon size={18} className="shrink-0" />
            {isSidebarOpen && <span>Settings</span>}
          </button>
        </nav>

        <div className={clsx("pt-6 border-t border-gray-800 space-y-4 w-full", !isSidebarOpen && "flex flex-col items-center")}>

          {/* Note: Undo button removed from here */}

          <div className={clsx("flex flex-col gap-1", isSidebarOpen ? "px-2" : "items-center")}>
            <div
              className={clsx("flex items-center gap-2 text-xs text-gray-500", !isSidebarOpen && "justify-center")}
              title="API Connected"
            >
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0"></span>
              {isSidebarOpen && "API Connected"}
            </div>

            {appVersion && (
              <div
                className={clsx(
                  "text-[10px] text-gray-600 font-mono cursor-pointer hover:text-blue-400 transition-colors",
                  !isSidebarOpen && "text-center w-full"
                )}
                onClick={() => {
                  if (updateStatus === 'idle' || updateStatus === 'error') {
                    checkUpdate();
                  }
                }}
                title={`v${appVersion} - Click to check for updates`}
              >
                v{appVersion}
              </div>
            )}

            {/* Update available badge/button */}
            {updateStatus === 'available' && (
              <button
                onClick={() => setIsUpdateModalOpen(true)}
                className={clsx(
                  "mt-2 w-full flex items-center gap-2 px-3 py-2 bg-blue-600/20 text-blue-400 rounded-lg text-xs font-bold border border-blue-600/50 hover:bg-blue-600/30 transition-all animate-pulse",
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
          <SettingsPage />
        ) : (
          <div className="space-y-8 animate-fade-in max-w-6xl mx-auto">

            {/* Initial Empty State / Scanner controls */}
            {!loadingMessage && !hasScanned && !error && (
              <div className="flex flex-col items-center justify-center py-20 bg-gray-800/30 border border-gray-700/50 rounded-3xl border-dashed relative">

                {/* Last Operation Undo Banner */}
                {hasHistory && (
                  <div className="absolute top-4 right-4 animate-fade-in">
                    <button
                      onClick={handleUndoClick}
                      className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 rounded-xl text-sm font-medium border border-yellow-500/20 transition-colors"
                    >
                      <RotateCcw size={16} />
                      Undo Last Batch
                    </button>
                  </div>
                )}

                <div className="bg-gray-800 p-4 rounded-full mb-6">
                  <FolderOpen size={48} className="text-blue-400" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Scan Your Media</h2>
                <p className="text-gray-400 mb-8 text-center max-w-md">
                  Drag and drop a folder here, or select a source<br />to automatically organize your files.
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
                    currentPath={null}
                    onPathSelect={handleSelection}
                    type="folder"
                    customButton={
                      <button className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors w-full">
                        <FolderOpen size={20} />
                        Browse Folder...
                      </button>
                    }
                  />
                  <FilePicker
                    currentPath={null}
                    onPathSelect={handleSelection}
                    type="file"
                    customButton={
                      <button className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors w-full">
                        <FolderOpen size={20} />
                        Select Files...
                      </button>
                    }
                  />
                </div>

                {defaultSource && (
                  <p className="mt-4 text-xs text-gray-500 font-mono">
                    Default: {defaultSource}
                  </p>
                )}
              </div>
            )}

            {/* No Files Found State */}
            {!loadingMessage && hasScanned && files.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center py-20 bg-gray-800/30 border border-gray-700/50 rounded-3xl border-dashed">
                <div className="bg-gray-800 p-4 rounded-full mb-6">
                  <FolderOpen size={48} className="text-gray-500" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">No Files Found</h2>
                <p className="text-gray-400 mb-8 text-center max-w-md">
                  We couldn't find any media files to reorganize in the selected location.
                </p>
                <button
                  onClick={() => {
                    setHasScanned(false);
                    setSourcePath(null);
                    setSelectedPaths([]);
                  }}
                  className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors"
                >
                  Go Back
                </button>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="p-4 rounded-lg bg-red-900/20 border border-red-800 text-red-200 flex justify-between items-center">
                <span>Error: {error}</span>
                <button
                  onClick={() => setError(null)}
                  className="px-3 py-1 bg-red-900/50 hover:bg-red-900/80 rounded text-sm"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Loading State */}
            {loadingMessage && (
              <div className="flex flex-col items-center justify-center py-32 text-gray-400">
                <Loader2 className="animate-spin mb-4 text-blue-500" size={48} />
                <p className="text-lg font-medium text-gray-300">{loadingMessage}</p>
                <p className="text-sm">This might take a moment depending on library size.</p>
              </div>
            )}

            {/* Results */}
            {!loadingMessage && files.length > 0 && (
              <section className="animate-fade-in space-y-4">
                <div className="flex items-center justify-between">
                  {/* ... Existing Results Header ... */}
                  <div className="flex items-center gap-4">
                    <h2 className="text-xl font-bold">Scan Results</h2>
                    <div className="h-6 w-px bg-gray-700 block mx-2"></div>
                    <div className="text-sm text-gray-400 font-mono">
                      {sourcePath}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => selectedPaths.length > 0 && handleSelection(selectedPaths)}
                      className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                      title="Rescan"
                    >
                      <RefreshCw size={20} />
                    </button>
                    <button
                      onClick={() => {
                        setFiles([]);
                        setSourcePath(null);
                        setSelectedPaths([]);
                        setHasScanned(false);
                      }}
                      className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                      title="Close"
                    >
                      <Home size={20} />
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-blue-900/10 border border-blue-900/30 rounded-xl flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="text-blue-200 text-sm">
                      Ready to process <strong>{files.length}</strong> files.
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
                    onClick={handleMoveAll}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 transform hover:-translate-y-0.5"
                  >
                    Execute Rename & Move
                  </button>
                </div>

                <GroupedFileList
                  files={files}
                  onRowClick={handleRowClick}
                  onRemove={handleRemoveFile}
                />
              </section>
            )}

            {/* Match Selection Modal is global */}
            <MatchSelectionModal
              isOpen={selectedFileIndex !== null}
              onClose={() => {
                setSelectedFileIndex(null);
                setIsReviewMode(false); // Cancel review if closed manually
              }}
              filename={selectedFile?.filename || ''}
              fileType={selectedFile?.file_type}
              candidates={selectedFile?.candidates || []}
              selectedIndex={selectedFile?.selected_index || 0}
              onUpdateCandidates={handleCandidatesUpdate}
              onSelect={handleCandidateSelect}
              onConfirm={handleConfirmSelection}
              onSkip={isReviewMode ? handleSkip : undefined}
              onBack={isReviewMode ? handleBack : undefined}
            />

            <UpdateModal
              isOpen={isUpdateModalOpen}
              onClose={() => setIsUpdateModalOpen(false)}
              update={updateAvailable}
              status={updateStatus}
              progress={downloadProgress}
              error={updateError}
              onConfirm={() => {
                installUpdate();
                // do not close modal here, it will show progress
              }}
            />

            {/* New Undo Modal */}
            <UndoPreviewModal
              isOpen={isUndoModalOpen}
              onClose={() => setIsUndoModalOpen(false)}
              onConfirm={confirmUndo}
              batch={undoBatch}
              isUndoing={isUndoing}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
