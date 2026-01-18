import { useState } from 'react';
import { clsx } from 'clsx';
import { FilePicker } from './components/FilePicker';
import { PreviewTable, type FileItem } from './components/PreviewTable';
import { MatchSelectionModal } from './components/MatchSelectionModal';
import { SettingsPage } from './components/SettingsPage';
import { scanDirectory, previewRename, type FileCandidate } from './api';
import { Loader2, Settings as SettingsIcon, Home, RefreshCw } from 'lucide-react';

function App() {
  // Navigation
  const [view, setView] = useState<'scanner' | 'settings'>('scanner');

  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null);

  async function handlePathSelect(path: string) {
    setSourcePath(path);
    setLoading(true);
    setError(null);
    setFiles([]);

    try {
      const result = await scanDirectory(path);
      const uiFiles: FileItem[] = result.files.map(f => ({
        original_path: f.original_path,
        filename: f.filename,
        file_type: f.file_type,
        candidates: f.candidates,
        selected_index: f.selected_index,
        proposed_path: f.proposed_path || null
      }));
      setFiles(uiFiles);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleRowClick(index: number) {
    setSelectedFileIndex(index);
  }

  async function handleCandidateSelect(candidateIndex: number) {
    if (selectedFileIndex === null) return;

    // Optimistically update selection
    setFiles(prev => prev.map((file, idx) => {
      if (idx !== selectedFileIndex) return file;
      return {
        ...file,
        selected_index: candidateIndex,
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

  function handleCandidatesUpdate(newCandidates: FileCandidate[]) {
    if (selectedFileIndex === null) return;

    setFiles(prev => prev.map((file, idx) => {
      if (idx !== selectedFileIndex) return file;
      return {
        ...file,
        candidates: newCandidates,
        selected_index: 0 // Reset selection to first new candidate
      };
    }));
  }

  function handleRemoveFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function handleMoveAll() {
    if (files.length === 0) return;

    // Optimistic UI update or global loader
    setLoading(true);

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
      // For simplicity, we just clear the list or re-scan. 
      // Re-scanning is safer to show remaining files.
      if (sourcePath) {
        handlePathSelect(sourcePath);
      } else {
        setFiles([]);
        setLoading(false);
      }

    } catch (err: any) {
      setError("Failed to move files: " + err.message);
      setLoading(false);
    }
  }

  const selectedFile = selectedFileIndex !== null ? files[selectedFileIndex] : null;

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans flex">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-gray-800 p-6 flex flex-col gap-6 bg-gray-900/50 backdrop-blur-sm fixed top-0 bottom-0 z-10 lg:relative lg:translate-x-0 transition-transform">
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

        <div className="pt-6 border-t border-gray-800">
          <div className="flex items-center gap-2 text-xs text-gray-500 px-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            API Connected
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 min-h-screen">
        {view === 'settings' ? (
          <SettingsPage />
        ) : (
          <div className="space-y-8 animate-fade-in">
            {/* Scanner View */}
            <section>
              <FilePicker
                currentPath={sourcePath}
                onPathSelect={handlePathSelect}
              />
            </section>

            {error && (
              <div className="p-4 rounded-lg bg-red-900/20 border border-red-800 text-red-200">
                Error: {error}
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <Loader2 className="animate-spin mb-3" size={32} />
                <p>Scanning directory...</p>
              </div>
            )}

            {!loading && files.length > 0 && (
              <section className="animate-fade-in">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold">Scan Results</h2>
                    <button
                      onClick={() => sourcePath && handlePathSelect(sourcePath)}
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
                      title="Refresh Scan"
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  <button
                    onClick={handleMoveAll}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Move All Files
                  </button>
                </div>
                <PreviewTable
                  files={files}
                  onRowClick={handleRowClick}
                  onRemove={handleRemoveFile}
                />
              </section>
            )}

            {!loading && sourcePath && files.length === 0 && !error && (
              <div className="text-center py-12 text-gray-500 bg-gray-800/30 rounded-xl border border-dashed border-gray-700">
                No media files found in this directory.
              </div>
            )}

            {/* Match Selection Modal is global */}
            <MatchSelectionModal
              isOpen={selectedFileIndex !== null}
              onClose={() => setSelectedFileIndex(null)}
              filename={selectedFile?.filename || ''}
              fileType={selectedFile?.file_type}
              candidates={selectedFile?.candidates || []}
              selectedIndex={selectedFile?.selected_index || 0}
              onUpdateCandidates={handleCandidatesUpdate}
              onSelect={handleCandidateSelect}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
