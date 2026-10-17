import { X, Check, Search, Film, Tv, Book, Star, Loader2, Headphones, AlertTriangle, FolderInput } from 'lucide-react';
import { clsx } from 'clsx';
import { useState, useEffect, useRef } from 'react';
import { manualSearch, type FileCandidate } from '../api';

interface MatchCardProps {
    candidate: FileCandidate;
    isSelected: boolean;
    onSelect: () => void;
}

export function MatchCard({ candidate, isSelected, onSelect }: MatchCardProps) {
    const Icon = candidate.type === 'movie' ? Film :
        candidate.type === 'tv' ? Tv :
            candidate.type === 'book' ? Book :
                candidate.type === 'audiobook' ? Headphones : Film;

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={isSelected}
            className={clsx(
                "relative flex flex-col text-left rounded-xl overflow-hidden cursor-pointer transition-all duration-200",
                "border-2 hover:scale-[1.02] hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400",
                isSelected
                    ? "border-blue-500 bg-blue-900/20 shadow-lg shadow-blue-500/20"
                    : "border-gray-700 bg-gray-800 hover:border-gray-500"
            )}
        >
            {/* Poster */}
            <div className="aspect-[2/3] w-full bg-gray-900 relative">
                {candidate.poster_url ? (
                    <img
                        src={candidate.poster_url}
                        alt={candidate.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                        <Icon size={48} className="text-gray-600" />
                    </div>
                )}

                {isSelected && (
                    <div className="absolute top-2 right-2 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center shadow-lg">
                        <Check size={18} className="text-white" />
                    </div>
                )}

                <div className="absolute bottom-2 left-2 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-xs font-medium flex items-center gap-1">
                    <Icon size={12} />
                    {candidate.type}
                </div>
            </div>

            {/* Info */}
            <div className="p-3 space-y-1 w-full">
                <h4 className="font-semibold text-white text-sm leading-tight line-clamp-2" title={candidate.title}>
                    {candidate.title}
                </h4>

                <div className="flex items-center gap-2 text-xs text-gray-400">
                    {candidate.year && <span>{candidate.year}</span>}
                    {!!candidate.score && (
                        <span className="flex items-center gap-0.5 text-yellow-400">
                            <Star size={10} fill="currentColor" />
                            {candidate.score.toFixed(1)}
                        </span>
                    )}
                    {candidate.author && (
                        <span className="truncate text-gray-500">by {candidate.author}</span>
                    )}
                </div>

                {candidate.episode_title && (
                    <p className="text-xs text-blue-300 truncate" title={candidate.episode_title}>Episode: {candidate.episode_title}</p>
                )}

                {candidate.overview && (
                    <p className="text-xs text-gray-500 line-clamp-2 mt-1">
                        {candidate.overview}
                    </p>
                )}
            </div>
        </button>
    );
}

// ============ Match Selection Modal ============

interface MatchSelectionModalProps {
    isOpen: boolean;
    onCancel: () => void;   // Close without keeping changes
    filename: string;
    parsedTitle?: string | null;
    fileType?: string;
    candidates: FileCandidate[];
    selectedIndex: number;
    proposedPath?: string | null;
    conflict?: boolean;
    groupSize?: number;     // > 1 when the choice applies to a whole group
    onUpdateCandidates: (newCandidates: FileCandidate[]) => void;
    onSelect: (index: number) => void;
    onConfirm: () => void;
    onSkip?: () => void;
    onBack?: () => void;
}

export function MatchSelectionModal({
    isOpen,
    onCancel,
    filename,
    parsedTitle,
    fileType,
    candidates,
    selectedIndex,
    proposedPath,
    conflict,
    groupSize = 1,
    onUpdateCandidates,
    onSelect,
    onConfirm,
    onSkip,
    onBack
}: MatchSelectionModalProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchType, setSearchType] = useState('movie');
    const dialogRef = useRef<HTMLDivElement>(null);

    // Reset state for each file the modal opens on: start the search box at the parsed title
    useEffect(() => {
        if (isOpen) {
            setSearchQuery(parsedTitle || '');
            setError(null);
            if (fileType && fileType !== 'unknown') {
                setSearchType(fileType);
            } else if (candidates.length > 0) {
                setSearchType(candidates[0].type);
            }
            dialogRef.current?.focus();
        }
        // Only when the modal opens on a (new) file
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, filename]);

    // Keyboard: Esc cancels; arrows move the selection and Enter confirms (outside text fields)
    useEffect(() => {
        if (!isOpen) return;
        function onKeyDown(e: KeyboardEvent) {
            const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
            if (e.key === 'Escape') {
                onCancel();
            } else if (!inField && (e.key === 'ArrowRight' || e.key === 'ArrowDown') && candidates.length) {
                e.preventDefault();
                onSelect(Math.min(selectedIndex + 1, candidates.length - 1));
            } else if (!inField && (e.key === 'ArrowLeft' || e.key === 'ArrowUp') && candidates.length) {
                e.preventDefault();
                onSelect(Math.max(selectedIndex - 1, 0));
            } else if (!inField && e.key === 'Enter' && candidates.length && !(e.target instanceof HTMLButtonElement)) {
                e.preventDefault();
                onConfirm();
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, candidates.length, selectedIndex, onCancel, onSelect, onConfirm]);

    if (!isOpen) return null;

    async function handleSearch() {
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        setError(null);
        try {
            const results = await manualSearch(searchQuery, searchType);
            onUpdateCandidates(results);
            if (results.length === 0) setError("No results. Try a different title or type.");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Search failed. Check your API key or connection.");
        } finally {
            setIsSearching(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />

            {/* Modal */}
            <div
                ref={dialogRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label="Select match"
                className="relative bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col outline-none animate-fade-in"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-800 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="min-w-0">
                            <h2 className="text-lg font-semibold text-white">
                                Select Match{groupSize > 1 && <span className="text-sm font-normal text-gray-400"> for {groupSize} files</span>}
                            </h2>
                            <p className="text-sm text-gray-400 truncate max-w-lg" title={filename}>
                                {filename}
                            </p>
                        </div>
                        <button
                            onClick={onCancel}
                            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
                            aria-label="Cancel"
                            title="Cancel (Esc)"
                        >
                            <X size={20} className="text-gray-400" />
                        </button>
                    </div>

                    {/* Search bar */}
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder={`Search for ${searchType}...`}
                                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                        </div>
                        <select
                            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            value={searchType}
                            onChange={(e) => setSearchType(e.target.value)}
                            aria-label="Media type"
                        >
                            <option value="movie">Movie</option>
                            <option value="tv">TV Show</option>
                            <option value="book">Book (Ebook)</option>
                            <option value="audiobook">Audiobook</option>
                        </select>
                        <button
                            onClick={handleSearch}
                            disabled={isSearching}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            {isSearching ? <Loader2 className="animate-spin" size={18} /> : 'Search'}
                        </button>
                    </div>
                    {error && <p className="text-red-400 text-xs">{error}</p>}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {candidates.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Search size={48} className="mx-auto mb-4 opacity-50" />
                            <p>No matches found.</p>
                            <p className="text-sm mt-2">Edit the title above and search again.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                            {candidates.map((candidate, idx) => (
                                <MatchCard
                                    key={`${candidate.type}-${candidate.id ?? candidate.title}-${idx}`}
                                    candidate={candidate}
                                    isSelected={idx === selectedIndex}
                                    onSelect={() => onSelect(idx)}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Resulting path */}
                {proposedPath && candidates.length > 0 && (
                    <div className="px-6 py-3 border-t border-gray-800 text-xs flex items-start gap-2">
                        <FolderInput size={14} className="text-gray-500 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <div className="font-mono text-green-300 break-all">{proposedPath}</div>
                            {conflict && (
                                <div className="flex items-center gap-1 text-yellow-400 mt-1">
                                    <AlertTriangle size={12} /> A file already exists here; this one will get a " (1)" suffix.
                                </div>
                            )}
                            {groupSize > 1 && <div className="text-gray-500 mt-1">Shown for this file; each file in the group gets its own name.</div>}
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between bg-gray-900/50">
                    <div className="flex items-center gap-4">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
                            >
                                Back
                            </button>
                        )}
                        <span className="text-sm text-gray-500">
                            {candidates.length} candidate{candidates.length !== 1 ? 's' : ''} · arrows to choose, Enter to confirm
                        </span>
                    </div>

                    <div className="flex gap-3">
                        {onSkip && (
                            <button
                                onClick={onSkip}
                                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
                            >
                                Skip
                            </button>
                        )}
                        <button
                            onClick={onConfirm}
                            disabled={candidates.length === 0}
                            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                        >
                            {groupSize > 1 ? `Apply to ${groupSize} files` : 'Confirm Selection'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
