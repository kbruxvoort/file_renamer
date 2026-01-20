import { X, Download, AlertTriangle, CheckCircle, Package } from 'lucide-react';
import type { Update } from '@tauri-apps/plugin-updater';

interface UpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
    update: Update | null;
    status: 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'up-to-date' | 'error';
    onConfirm: () => void;
    progress: number;
    error: string | null;
}

export function UpdateModal({ isOpen, onClose, update, status, onConfirm, progress, error }: UpdateModalProps) {
    if (!isOpen || !update) return null;

    const isDownloading = status === 'downloading' || status === 'installing';

    // Parse body if it exists, simple formatting
    const releaseNotes = update.body || "No release notes provided.";

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={!isDownloading ? onClose : undefined}
            />

            {/* Modal */}
            <div className="relative bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col animate-fade-in">

                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-600/20 p-2 rounded-lg text-blue-400">
                            <Package size={24} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Update Available</h2>
                            <p className="text-xs text-gray-400">Version {update.version}</p>
                        </div>
                    </div>
                    {!isDownloading && (
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-gray-800 transition-colors text-gray-400 hover:text-white"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Status/Error Messages */}
                    {status === 'error' && (
                        <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-lg flex items-center gap-3 text-red-200 text-sm">
                            <AlertTriangle size={18} />
                            <p>{error || "An unknown error occurred."}</p>
                        </div>
                    )}

                    {!isDownloading ? (
                        <div className="space-y-4">
                            <div className="prose prose-invert prose-sm max-h-60 overflow-y-auto bg-gray-950/50 p-4 rounded-xl border border-gray-800">
                                <h3 className="text-gray-300 font-semibold mb-2">What's New:</h3>
                                <pre className="whitespace-pre-wrap font-sans text-gray-400 text-sm">
                                    {releaseNotes}
                                </pre>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-yellow-500/80 bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20">
                                <AlertTriangle size={14} />
                                <p>The application will restart automatically after update.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="py-8 space-y-6 text-center">
                            {status === 'installing' ? (
                                <div className="space-y-4">
                                    <div className="mx-auto w-16 h-16 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center animate-pulse">
                                        <CheckCircle size={32} />
                                    </div>
                                    <h3 className="text-xl font-semibold text-white">Installing Update...</h3>
                                    <p className="text-gray-400">Sortify is restarting.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <h3 className="text-white font-medium">Downloading Update...</h3>
                                    <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 transition-all duration-300 ease-out"
                                            style={{ width: `${Math.max(5, progress)}%` }} // Minimum 5% visible
                                        />
                                    </div>
                                    <p className="text-right text-xs text-gray-500 font-mono">{progress.toFixed(1)}%</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {!isDownloading && (
                    <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3 bg-gray-900/50">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
                        >
                            Remind Me Later
                        </button>
                        <button
                            onClick={onConfirm}
                            className="flex items-center gap-2 px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors shadow-lg shadow-blue-900/20"
                        >
                            <Download size={18} />
                            Update Now
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
