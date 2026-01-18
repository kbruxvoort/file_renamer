
import { Save, FolderOpen, Eye, EyeOff } from 'lucide-react';
import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

interface Settings {
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
}

const API_BASE = "http://127.0.0.1:8742";

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

export function SettingsPage() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [showKey, setShowKey] = useState(false);

    useEffect(() => {
        loadSettings();
    }, [showKey]);

    async function loadSettings() {
        try {
            // Pass visible=true if showKey is on, otherwise we get ***
            const res = await fetch(`${API_BASE}/config?reveal_keys=${showKey}`);
            if (!res.ok) throw new Error("Failed to load config");
            const data = await res.json();
            setSettings(data);
        } catch (err) {
            console.error(err);
            setMessage({ type: 'error', text: "Failed to load settings" });
        } finally {
            setLoading(false);
        }
    }

    async function updateSetting(key: string, value: string) {
        if (!settings) return;

        // Optimistic update
        setSettings({ ...settings, [key]: value });

        try {
            const res = await fetch(`${API_BASE}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value })
            });
            if (!res.ok) throw new Error("Failed to save");
            // Clear message after 3s
            setMessage({ type: 'success', text: "Saved" });
            setTimeout(() => setMessage(null), 3000);
        } catch (err) {
            console.error(err);
            setMessage({ type: 'error', text: `Failed to save ${key}` });
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

            {message && (
                <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg border backdrop-blur-md transition-all ${message.type === 'success' ? 'bg-green-900/80 border-green-800 text-green-200'
                    : 'bg-red-900/80 border-red-800 text-red-200'
                    }`}>
                    {message.text}
                </div>
            )}

            {/* API Keys */}
            <section className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">API Keys</h3>
                <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">TMDB API Key</label>
                        <div className="relative">
                            <input
                                type={showKey ? "text" : "password"}
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-4 pr-12 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                                placeholder="Enter your TMDB API Key"
                                value={settings.TMDB_API_KEY || ''}
                                onChange={(e) => updateSetting('TMDB_API_KEY', e.target.value)}
                            />
                            <button
                                onClick={() => setShowKey(!showKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                                title={showKey ? "Hide Key" : "Show Key"}
                            >
                                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Required for Movie & TV metadata.</p>
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

                    {/* Movies */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-sm font-medium text-gray-300">Movies</label>
                            <select
                                className="bg-gray-900 text-xs text-gray-400 border border-gray-700 rounded px-2 py-1 outline-none focus:border-blue-500"
                                onChange={(e) => e.target.value && updateSetting('MOVIE_TEMPLATE', e.target.value)}
                                value=""
                            >
                                <option value="">Quick Presets...</option>
                                {PRESETS.movies.map((p, i) => (
                                    <option key={i} value={p.value}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <input
                            type="text"
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={settings.MOVIE_TEMPLATE}
                            onChange={(e) => updateSetting('MOVIE_TEMPLATE', e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">Available: {'{title}, {year}, {ext}'}</p>
                    </div>

                    {/* TV */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-sm font-medium text-gray-300">TV Shows</label>
                            <select
                                className="bg-gray-900 text-xs text-gray-400 border border-gray-700 rounded px-2 py-1 outline-none focus:border-blue-500"
                                onChange={(e) => e.target.value && updateSetting('TV_TEMPLATE', e.target.value)}
                                value=""
                            >
                                <option value="">Quick Presets...</option>
                                {PRESETS.tv.map((p, i) => (
                                    <option key={i} value={p.value}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <input
                            type="text"
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={settings.TV_TEMPLATE}
                            onChange={(e) => updateSetting('TV_TEMPLATE', e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">Available: {'{title}, {season}, {episode}, {episode_title}, {ext}'}</p>
                    </div>

                    {/* Books */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-sm font-medium text-gray-300">Books (Ebooks)</label>
                            <select
                                className="bg-gray-900 text-xs text-gray-400 border border-gray-700 rounded px-2 py-1 outline-none focus:border-blue-500"
                                onChange={(e) => e.target.value && updateSetting('BOOK_TEMPLATE', e.target.value)}
                                value=""
                            >
                                <option value="">Quick Presets...</option>
                                {PRESETS.books.map((p, i) => (
                                    <option key={i} value={p.value}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <input
                            type="text"
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={settings.BOOK_TEMPLATE}
                            onChange={(e) => updateSetting('BOOK_TEMPLATE', e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">Available: {'{author}, {title}, {year}, {ext}'}</p>
                    </div>

                    {/* Audiobooks */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-sm font-medium text-gray-300">Audiobooks</label>
                            <select
                                className="bg-gray-900 text-xs text-gray-400 border border-gray-700 rounded px-2 py-1 outline-none focus:border-blue-500"
                                onChange={(e) => e.target.value && updateSetting('AUDIOBOOK_TEMPLATE', e.target.value)}
                                value=""
                            >
                                <option value="">Quick Presets...</option>
                                {PRESETS.books.map((p, i) => (
                                    <option key={i} value={p.value}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <input
                            type="text"
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={settings.AUDIOBOOK_TEMPLATE}
                            onChange={(e) => updateSetting('AUDIOBOOK_TEMPLATE', e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">Available: {'{author}, {title}, {year}, {ext}'}</p>
                    </div>
                </div>
            </section>
        </div>
    );
}
