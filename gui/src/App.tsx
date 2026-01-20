import { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { FilePicker } from './components/FilePicker';
import { type FileItem } from './types';
import { GroupedFileList } from './components/GroupedFileList';
import { MatchSelectionModal } from './components/MatchSelectionModal';
import { SettingsPage } from './components/SettingsPage';
import { scanDirectory, previewRename, getConfig, undoLastOperation, getHistory, sendHeartbeat, type FileCandidate } from './api';
import { Loader2, Settings as SettingsIcon, Home, RefreshCw, FolderOpen, Play, RotateCcw } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';

function App() {
  // Navigation
  const [view, setView] = useState<'scanner' | 'settings'>('scanner');

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

  // Undo visibility
  const [hasHistory, setHasHistory] = useState(false);

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

  // Update Check
  useEffect(() => {
    async function checkForUpdates() {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const { ask } = await import('@tauri-apps/plugin-dialog');
        const { relaunch } = await import('@tauri-apps/plugin-process');

        const update = await check();
        if (update && update.available) {
          const yes = await ask(
            `A new version of Sortify is available: ${update.version}\n\nDo you want to update now?`,
            { title: 'Update Available', kind: 'info', okLabel: 'Update', cancelLabel: 'Cancel' }
          );
          if (yes) {
            await update.downloadAndInstall();
            await relaunch();
          }
        }
      } catch (e) {
        console.error("Failed to check for updates:", e);
      }
    }

    checkForUpdates();
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
      const uiFiles: FileItem[] = result.files.map(f => ({
        original_path: f.original_path,
        filename: f.filename,
        file_type: f.file_type,
        candidates: f.candidates,
        selected_index: f.selected_index,
        proposed_path: f.proposed_path || null
      }));
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
        // confirmed: true, // Moved to handleConfirmSelection
        // Keep old proposed path momentarily or set to loading...
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

  async function propagateMatchToFolder(sourceIndex: number, candidateId: number | undefined): Promise<number[]> {
    if (candidateId === undefined) return [];

    const sourceFile = files[sourceIndex];
    if (!sourceFile) return [];
    const sourceCand = sourceFile.candidates[sourceFile.selected_index];
    if (!sourceCand) return [];

    // Get folder path
    const platformSep = sourceFile.original_path.includes('\\') ? '\\' : '/';
    const sourceDir = sourceFile.original_path.substring(0, sourceFile.original_path.lastIndexOf(platformSep));

    const updates: { index: number, candidateIndex: number }[] = [];
    const newFiles = [...files]; // Clone for mutation during loop

    files.forEach((f, idx) => {
      if (idx === sourceIndex) return;

      // Check if same folder
      const fDir = f.original_path.substring(0, f.original_path.lastIndexOf(platformSep));
      if (fDir !== sourceDir) return;

      // Try to find matching candidate ID
      let candIdx = f.candidates.findIndex(c => c.id === candidateId);

      // If NOT found, Synthesize it! (Force Propagation)
      if (candIdx === -1) {
        // Clone source candidate but strip episode-specifics
        // We want the Show Metadata (Title, Year, ID), but not "Episode Title" of the source
        const { episode_title, overview, ...baseCand } = sourceCand as any;

        // Need to cast to satisfy type if needed, or just construct object
        const newCand = {
          ...baseCand,
          // We intentionally omit info that might be specific to the source episode
          episode_title: undefined,
          overview: undefined
        };

        // Append to this file's candidates
        const newCands = [...f.candidates, newCand];
        newFiles[idx] = { ...newFiles[idx], candidates: newCands };
        candIdx = newCands.length - 1; // It's the last one
      }

      // If we found it (or created it), and it's not already selected
      if (candIdx !== -1 && candIdx !== newFiles[idx].selected_index) {
        updates.push({ index: idx, candidateIndex: candIdx });
      }
    });

    if (updates.length > 0) {
      // Parallel fetch previews
      await Promise.all(updates.map(async (up) => {
        newFiles[up.index].selected_index = up.candidateIndex;
        newFiles[up.index].confirmed = true; // Auto-confirm propagated matches

        try {
          const cand = newFiles[up.index].candidates[up.candidateIndex];
          // Determine path
          const p = await previewRename(newFiles[up.index].original_path, cand);
          if (p) newFiles[up.index].proposed_path = p;
        } catch (e) {
          console.error(e);
        }
      }));

      setFiles(newFiles);
      console.log(`Propagated match to ${updates.length} files.`);
      return updates.map(u => u.index);
    }
    return [];
  }

  async function handleConfirmSelection() {
    if (selectedFileIndex === null) return;

    // Get info for propagation BEFORE clearing index
    const currentFile = files[selectedFileIndex];
    if (!currentFile) return;

    const selectedCand = currentFile.candidates[currentFile.selected_index];
    const currentIdx = selectedFileIndex;

    // We update local var to reflect future state for logic
    const propagatedIndices: number[] = [];

    // Trigger Propagation Logic (Wait for it so we know what matches)
    if (selectedCand?.id) {
      const indices = await propagateMatchToFolder(currentIdx, selectedCand.id);
      propagatedIndices.push(...indices);
    }

    // Now update state for the current file too
    setFiles(prev => prev.map((f, idx) => {
      if (idx !== selectedFileIndex) return f;
      return { ...f, confirmed: true };
    }));

    // If in review mode, find next uncertain item
    if (isReviewMode) {
      // Logic: Index > Current, NOT Propagated, NOT Confirmed, NOT Unambiguous
      const nextUncertain = files.findIndex((f, idx) =>
        idx > selectedFileIndex &&
        !f.confirmed &&
        !propagatedIndices.includes(idx) &&
        f.candidates.length > 1
      );

      if (nextUncertain !== -1) {
        setSelectedFileIndex(nextUncertain);
      } else {
        const anyUncertain = files.findIndex((f, idx) =>
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
          // alert("Review complete!");
        }
      }
    } else {
      setSelectedFileIndex(null);
    }
  }



  // ... (rest of render)

  // Replace PreviewTable with GroupedFileList
  <GroupedFileList
    files={files}
    onRowClick={handleRowClick}
    onRemove={handleRemoveFile}
    onPropagateMatch={() => { }} // Propagation handled in modal confirm for now
  />

  async function handleCandidatesUpdate(newCandidates: FileCandidate[]) {
    if (selectedFileIndex === null) return;

    // Get the file to update
    const file = files[selectedFileIndex];
    let newPath = file.proposed_path;

    // If we have candidates, fetch a preview for the first one immediately
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
    // Start review mode
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

    // Optimistic UI update or global loader
    setLoadingMessage("Moving files... This may take a moment for large libraries.");

    // Prepare execute request
    const payload = {
      files: files.map(f => ({
        original_path: f.original_path,
        selected_candidate: f.candidates[f.selected_index] || null
      }))
    };

    try {
      const { executeMoves } = await import('./api');
      const result = await executeMoves(payload);

      // Show result (simple alert for now or notification)
      alert(`Moved ${result.moved.length} files. ${result.errors.length} errors.`);

      // Clear files that were moved successfully
      // Rescan if we have selected paths
      if (selectedPaths.length > 0) {
        handleSelection(selectedPaths);
      } else {
        setFiles([]);
        setLoadingMessage(null);
      }

      // Update history state
      setHasHistory(true);

    } catch (err: any) {
      setError("Failed to move files: " + err.message);
      setLoadingMessage(null);
    }
  }

  function handleSkip() {
    // Skip current item without confirming
    // Find next uncertain item STARTING AFTER current index
    if (selectedFileIndex === null) return;

    // Logic similar to handleConfirm but doesn't set confirmed=true
    const nextUncertain = files.findIndex((f, idx) =>
      idx > selectedFileIndex && !f.confirmed && f.candidates.length > 1
    );

    if (nextUncertain !== -1) {
      setSelectedFileIndex(nextUncertain);
    } else {
      // No more forward matches - Exit wizard
      setIsReviewMode(false);
      setSelectedFileIndex(null);
    }
  }

  function handleBack() {
    // Go to previous uncertain item
    if (selectedFileIndex === null) return;

    // Find LAST uncertain item that is BEFORE current index
    // Iterate backwards from selectedIndex - 1
    let prevUncertain = -1;
    for (let i = selectedFileIndex - 1; i >= 0; i--) {
      if (!files[i].confirmed && files[i].candidates.length > 1) {
        prevUncertain = i;
        break;
      }
    }

    if (prevUncertain !== -1) {
      setSelectedFileIndex(prevUncertain);
    } else {
      // No regular previous item.
    }
  }

  const selectedFile = selectedFileIndex !== null ? files[selectedFileIndex] : null;
  const uncertainCount = files.filter(f => !f.confirmed && f.candidates.length > 1).length;

  async function handleUndo() {
    if (!confirm("Are you sure you want to undo the last batch of moves?")) return;

    setLoadingMessage("Undoing last operation...");
    try {
      const result = await undoLastOperation();
      if (result.success) {
        alert(`Undo Successful! Restored ${result.restored_count} files.`);
        // Refresh if showing source
        if (selectedPaths.length > 0) {
          handleSelection(selectedPaths);
        } else {
          setFiles([]);
          setLoadingMessage(null);
        }

        // Re-check info
        getHistory().then((hist: any[]) => setHasHistory(hist.length > 0));

      } else {
        alert(`Undo Failed: ${result.message}`);
        setLoadingMessage(null);
      }
    } catch (e: any) {
      alert("Undo failed: " + e.message);
      setLoadingMessage(null);
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
      <aside className="w-64 flex-none h-full border-r border-gray-800 p-6 flex flex-col gap-6 bg-gray-900/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3 px-2">
          <img src="/icon.png" alt="Logo" className="w-8 h-8 rounded-lg" />
          <h1 className="text-xl font-bold tracking-tight">Sortify</h1>
        </div>

        <nav className="flex-1 space-y-1">
          <button
            onClick={() => setView('scanner')}
            className={clsx(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              view === 'scanner' ? "bg-blue-600/10 text-blue-400" : "text-gray-400 hover:bg-gray-800 hover:text-gray-100"
            )}
          >
            <Home size={18} />
            Scanner
          </button>
          <button
            onClick={() => setView('settings')}
            className={clsx(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              view === 'settings' ? "bg-blue-600/10 text-blue-400" : "text-gray-400 hover:bg-gray-800 hover:text-gray-100"
            )}
          >
            <SettingsIcon size={18} />
            Settings
          </button>
        </nav>

        <div className="pt-6 border-t border-gray-800 space-y-4">
          {hasHistory && (
            <button
              onClick={handleUndo}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-yellow-500 hover:bg-yellow-500/10 transition-colors"
            >
              <RotateCcw size={18} />
              Undo Last Batch
            </button>
          )}
          <div className="flex flex-col gap-1 px-2">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              API Connected
            </div>
            {appVersion && (
              <div className="text-[10px] text-gray-600 font-mono">
                v{appVersion}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-y-auto p-8 relative">
        {view === 'settings' ? (
          <SettingsPage />
        ) : (
          <div className="space-y-8 animate-fade-in max-w-6xl mx-auto">

            {/* Initial Empty State / Scanner controls */}
            {!loadingMessage && !hasScanned && !error && (
              <div className="flex flex-col items-center justify-center py-20 bg-gray-800/30 border border-gray-700/50 rounded-3xl border-dashed">
                <div className="bg-gray-800 p-4 rounded-full mb-6">
                  <FolderOpen size={48} className="text-blue-400" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Scan Your Media</h2>
                <p className="text-gray-400 mb-8 text-center max-w-md">
                  Drag and drop a folder here, or select a source<br />to automatically organize your files.
                </p>

                <div className="flex gap-4">
                  {defaultSource && (
                    <button
                      onClick={() => handleSelection([defaultSource])}
                      className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors shadow-lg shadow-blue-900/20"
                    >
                      <Play size={20} fill="currentColor" />
                      Scan Default
                    </button>
                  )}
                  <div className="flex flex-col gap-2">
                    <FilePicker
                      currentPath={null}
                      onPathSelect={handleSelection}
                      type="folder"
                      customButton={
                        <button className="flex items-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors w-full justify-center">
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
                        <button className="flex items-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors w-full justify-center">
                          <FolderOpen size={20} />
                          Select Files...
                        </button>
                      }
                    />
                  </div>
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
                  onPropagateMatch={() => { }}
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
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
