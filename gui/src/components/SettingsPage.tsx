import { Save, FolderOpen, Eye, EyeOff, RotateCcw, ExternalLink } from 'lucide-react';
import { useState, useEffect, type KeyboardEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { getConfig, updateConfig, templatePreview, type AppConfig } from '../api';
import { toast } from './toast';

type TemplateKey = 'MOVIE_TEMPLATE' | 'TV_TEMPLATE' | 'BOOK_TEMPLATE' | 'AUDIOBOOK_TEMPLATE';

// Presets
const PRESETS = {
    movies: [
        { name: "Plex/Jellyfin (Standard)", value: "{title} ({year})/{title} ({year}){ext}" },
        { name: "Flat (No Folders)", value: "{title} ({year}){ext}" },
    ],
    tv: [
        { name: "Plex/Jellyfin (Standard)", value: "{title} ({year})/Season {season}/{title} - s{season}e{episode} - {episode_title}{ext}" },
        { name: "Simple", value: "{title} - s{season}e{episode}{ext}" },
    ],
    books: [
        { name: "Audiobookshelf", value: "{author}/{title}/{title}{ext}" },
        { name: "Calibre-ish", value: "{author}/{title} ({year})/{title}{ext}" },
        { name: "Simple", value: "{author} - {title}{ext}" },
    ]
};

// Text input that keeps a local draft and only saves on blur or Enter,
// so half-typed values (e.g. "{tit") are never written to the config.
function DraftInput({ value, onSave, className, type = "text", placeholder }: {
    value: string;
    onSave: (value: string) => Promise<string | null>; // resolves to an error message, or null
    className?: string;
    type?: string;
    placeholder?: string;
}) {
    const [draft, setDraft] = useState(value);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { setDraft(value); }, [value]);

    async function commit() {
        if (draft === value) return;
        setError(await onSave(draft));
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value); setError(null); }
    }

    return (
        <>
            <input
                type={type}
                className={className}
                placeholder={placeholder}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={handleKeyDown}
            />
            {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        </>
    );
}

// Template input with a live preview against a sample file. Saves on blur/Enter only.
function TemplateField({ label, value, defaultValue, mediaType, presets, variables, onSave }: {
    label: string;
    value: string;
    defaultValue?: string;
    mediaType: string;
    presets: { name: string; value: string }[];
    variables: string;
    onSave: (value: string) => Promise<string | null>;
}) {
    const [draft, setDraft] = useState(value);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [preview, setPreview] = useState<{ path: string | null; error: string | null } | null>(null);

    useEffect(() => { setDraft(value); }, [value]);

    // Debounced preview of whatever is typed, before it's saved
    useEffect(() => {
        const timer = setTimeout(() => {
            templatePreview(draft, mediaType).then(setPreview).catch(() => setPreview(null));
        }, 300);
        return () => clearTimeout(timer);
    }, [draft, mediaType]);

    async function save(next: string) {
        setDraft(next);
        if (next === value) return;
        setSaveError(await onSave(next));
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value); setSaveError(null); }
    }

    const presetValue = presets.find(p => p.value === draft)?.value ?? "custom";
    const error = saveError || preview?.error;

    return (
        <div>
            <div className="flex justify-between items-center mb-1 gap-2">
                <label className="block text-sm font-medium text-gray-300">{label}</label>
                <div className="flex items-center gap-2">
                    {defaultValue && draft !== defaultValue && (
                        <button
                            onClick={() => save(defaultValue)}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white"
                            title={`Reset to ${defaultValue}`}
                        >
                            <RotateCcw size={12} /> Reset
                        </button>
                    )}
                    <select
                        className="bg-gray-900 text-xs text-gray-400 border border-gray-700 rounded px-2 py-1 outline-none focus:border-blue-500"
                        onChange={(e) => { if (e.target.value !== 'custom') save(e.target.value); }}
                        value={presetValue}
                        aria-label={`${label} preset`}
                    >
                        <option value="custom" disabled>Custom</option>
                        {presets.map((p, i) => <option key={i} value={p.value}>{p.name}</option>)}
                    </select>
                </div>
            </div>
            <input
                type="text"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setSaveError(null); }}
                onBlur={() => save(draft)}
                onKeyDown={handleKeyDown}
                aria-label={`${label} template`}
            />
            {error ? (
                <p className="text-xs text-red-400 mt-1">{error}</p>
            ) : preview?.path ? (
                <p className="text-xs text-gray-400 mt-1 font-mono truncate" title={preview.path}>
                    <span className="text-gray-500 font-sans">Example: </span>{preview.path}
                </p>
            ) : null}
            <p className="text-xs text-gray-500 mt-1">Available: {variables}</p>
        </div>
    );
}

export function SettingsPage({ onSaved }: { onSaved?: () => void }) {
    const [settings, setSettings] = useState<AppConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [showKey, setShowKey] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getConfig(showKey)
            .then(data => { if (!cancelled) setSettings(data); })
            .catch(err => toast(`Failed to load settings: ${err instanceof Error ? err.message : err}`, 'error'))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [showKey]);

    async function updateSetting(key: string, value: string): Promise<string | null> {
        try {
            const warning = await updateConfig(key, value);
            // Keep only the masked key in state unless it's being shown
            const stored = key === 'TMDB_API_KEY' && !showKey ? `***${value.slice(-4)}` : value;
            setSettings(prev => prev ? { ...prev, [key]: stored } : prev);
            toast(warning || "Saved", warning ? 'info' : 'success');
            onSaved?.();
            return null;
        } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            toast(`Couldn't save: ${text}`, 'error');
            return text;
        }
    }

    async function browseFolder(key: 'SOURCE_DIR' | 'DEST_DIR' | 'MOVIE_DIR' | 'TV_DIR' | 'BOOK_DIR' | 'AUDIOBOOK_DIR') {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: "Select Directory"
            });

            if (selected && typeof selected === 'string') {
                updateSetting(key, selected);
            }
        } catch (err) {
            console.error("Failed to open dialog:", err);
        }
    }

    if (loading) return <div className="p-8 text-center text-gray-500">Loading settings...</div>;
    if (!settings) return <div className="p-8 text-center text-red-400">Error loading settings</div>;

    const templateFields: { key: TemplateKey; label: string; mediaType: string; presets: { name: string; value: string }[]; variables: string }[] = [
        { key: 'MOVIE_TEMPLATE', label: 'Movies', mediaType: 'movie', presets: PRESETS.movies, variables: '{title}, {year}, {ext}' },
        { key: 'TV_TEMPLATE', label: 'TV Shows', mediaType: 'tv', presets: PRESETS.tv, variables: '{title}, {year} (show premiere), {season}, {episode}, {episode_title}, {ext}' },
        { key: 'BOOK_TEMPLATE', label: 'Books (Ebooks)', mediaType: 'book', presets: PRESETS.books, variables: '{author}, {title}, {year}, {ext}' },
        { key: 'AUDIOBOOK_TEMPLATE', label: 'Audiobooks', mediaType: 'audiobook', presets: PRESETS.books, variables: '{author}, {title}, {year}, {ext}' },
    ];

    return (
        <div className="w-full max-w-6xl mx-auto space-y-8 animate-fade-in pb-12">
            <div>
                <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Save size={20} /> Configuration
                </h2>
                <p className="text-gray-400 text-sm">
                    Settings are saved to <code>~/.renamer_config.json</code>
                </p>
            </div>

            {/* API Keys */}
            <section className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">API Keys</h3>
                <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">TMDB API Key</label>
                        <div className="relative">
                            {/* Masked mode starts empty (placeholder shows the saved key's tail) so the
                                "***abcd" mask can never be saved back as the key */}
                            <DraftInput
                                type={showKey ? "text" : "password"}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-4 pr-12 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                                placeholder={settings.TMDB_API_KEY ? `Saved (${settings.TMDB_API_KEY}) - type to replace` : "Enter your TMDB API Key"}
                                value={showKey ? (settings.TMDB_API_KEY || '') : ''}
                                onSave={(v) => v.trim() ? updateSetting('TMDB_API_KEY', v.trim()) : Promise.resolve(null)}
                            />
                            <button
                                onClick={() => setShowKey(!showKey)}
                                aria-label={showKey ? "Hide key" : "Show key"}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                                title={showKey ? "Hide Key" : "Show Key"}
                            >
                                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Required for Movie & TV metadata. The key is checked with TMDB when you save.{' '}
                            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-400 hover:underline">
                                Get a free key <ExternalLink size={10} />
                            </a>
                        </p>
                    </div>
                </div>
            </section>

            {/* Directories */}
            <section className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Directories</h3>
                <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 space-y-6">

                    {/* Source */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Default Source Directory</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-400 text-sm font-mono overflow-ellipsis"
                                value={settings.SOURCE_DIR || 'Not set'}
                                readOnly
                            />
                            <button
                                onClick={() => browseFolder('SOURCE_DIR')}
                                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
                                title="Browse..."
                            >
                                <FolderOpen size={18} />
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-gray-700/50" />

                    {/* Destinations */}
                    <div className="grid gap-4">
                        {[
                            { label: "Movies Destination", key: 'MOVIE_DIR' as const },
                            { label: "TV Shows Destination", key: 'TV_DIR' as const },
                            { label: "Books Destination", key: 'BOOK_DIR' as const },
                            { label: "Audiobooks Destination", key: 'AUDIOBOOK_DIR' as const },
                        ].map((item) => (
                            <div key={item.key}>
                                <label className="block text-sm font-medium text-gray-300 mb-1">{item.label}</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-400 text-sm font-mono overflow-ellipsis"
                                        value={settings[item.key]}
                                        readOnly
                                    />
                                    <button
                                        onClick={() => browseFolder(item.key)}
                                        className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
                                        title="Browse..."
                                    >
                                        <FolderOpen size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Naming Templates */}
            <section className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Naming Templates</h3>
                <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 space-y-6">

                    {templateFields.map(field => (
                        <TemplateField
                            key={field.key}
                            label={field.label}
                            value={settings[field.key]}
                            defaultValue={settings.DEFAULT_TEMPLATES?.[field.key]}
                            mediaType={field.mediaType}
                            presets={field.presets}
                            variables={field.variables}
                            onSave={(v) => updateSetting(field.key, v)}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}
