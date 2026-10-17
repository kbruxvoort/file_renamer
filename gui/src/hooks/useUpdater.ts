import { useState, useEffect, useCallback, useRef } from 'react';
import { check, Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { shutdownBackend } from '../api';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'up-to-date' | 'error';

interface UseUpdaterReturn {
    status: UpdateStatus;
    updateAvailable: Update | null;
    downloadProgress: number; // 0-100
    error: string | null;
    needsRestart: boolean;     // Backend was stopped but the install failed
    checkUpdate: (silent?: boolean) => Promise<void>;
    installUpdate: () => Promise<void>;
    restartApp: () => Promise<void>;
    mockUpdate: () => void; // Trigger for testing
}

export function useUpdater(): UseUpdaterReturn {
    const [status, setStatus] = useState<UpdateStatus>('idle');
    const [updateAvailable, setUpdateAvailable] = useState<Update | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [needsRestart, setNeedsRestart] = useState(false);

    // Track if we are mocking to prevent a real shutdown/relaunch
    const isMocking = useRef(false);

    const checkUpdate = useCallback(async (silent = false) => {
        if (!silent) setStatus('checking');
        setError(null);
        isMocking.current = false;

        try {
            const update = await check();
            if (update) {
                setUpdateAvailable(update);
                setStatus('available');
            } else {
                setUpdateAvailable(null);
                if (!silent) {
                    setStatus('up-to-date');
                    // Reset to idle after a moment if just checking
                    setTimeout(() => setStatus('idle'), 3000);
                }
            }
        } catch (e) {
            console.error("Update check failed:", e);
            if (!silent) {
                setError(e instanceof Error ? e.message : String(e) || "Failed to check for updates");
                setStatus('error');
            }
        }
    }, []);

    const installUpdate = useCallback(async () => {
        if (!updateAvailable) return;

        setStatus('downloading');
        setDownloadProgress(0);
        setError(null);

        let total = 0;
        let downloaded = 0;
        const onEvent = (event: DownloadEvent) => {
            if (event.event === 'Started') {
                total = event.data.contentLength || 0;
            } else if (event.event === 'Progress') {
                downloaded += event.data.chunkLength;
                if (total > 0) setDownloadProgress((downloaded / total) * 100);
            } else if (event.event === 'Finished') {
                setDownloadProgress(100);
            }
        };

        // 1. Download while the app keeps working. A failed download leaves everything running.
        try {
            await updateAvailable.download(onEvent);
        } catch (e) {
            console.error("Update download failed:", e);
            setError(e instanceof Error ? e.message : String(e) || "Failed to download update");
            setStatus('error');
            return;
        }

        if (isMocking.current) {
            setStatus('idle');
            setUpdateAvailable(null);
            isMocking.current = false;
            return;
        }

        // 2. Only now stop the backend, so the installer can replace its locked executable
        setStatus('installing');
        await shutdownBackend();
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 3. Install. On Windows the installer normally closes and relaunches the app itself.
        try {
            await updateAvailable.install();
            await relaunch();
        } catch (e) {
            console.error("Update installation failed:", e);
            // The backend is already stopped; the only way back is a restart
            setNeedsRestart(true);
            setError(`${e instanceof Error ? e.message : String(e) || "Failed to install update"}. Restart Sortify to continue.`);
            setStatus('error');
        }
    }, [updateAvailable]);

    const restartApp = useCallback(async () => {
        await relaunch();
    }, []);

    // Mock function for testing (dev only)
    const mockUpdate = useCallback(() => {
        isMocking.current = true;
        const mockObj = {
            available: true,
            version: "0.2.0-beta",
            currentVersion: "0.1.6",
            date: new Date().toISOString(),
            body: "## Amazing New Features\n- Better UI\n- Faster Scanning\n- Bug Fixes\n\nThis is a mock update for testing.",
            download: (cb: (e: DownloadEvent) => void) => {
                return new Promise<void>((resolve) => {
                    const total = 100 * 1024 * 1024; // 100MB
                    cb({ event: 'Started', data: { contentLength: total } });

                    let current = 0;
                    const chunk = 2 * 1024 * 1024;

                    const interval = setInterval(() => {
                        current += chunk;
                        if (current <= total) {
                            cb({ event: 'Progress', data: { chunkLength: chunk } });
                        } else {
                            clearInterval(interval);
                            cb({ event: 'Finished' });
                            setTimeout(resolve, 500);
                        }
                    }, 50);
                });
            },
        } as unknown as Update;

        setUpdateAvailable(mockObj);
        setStatus('available');
    }, []);

    // Initial check
    useEffect(() => {
        // Deferred so the check never runs inside the render/effect pass
        const timer = setTimeout(() => checkUpdate(true), 0);
        return () => clearTimeout(timer);
    }, [checkUpdate]);

    return {
        status,
        updateAvailable,
        downloadProgress,
        error,
        needsRestart,
        checkUpdate,
        installUpdate,
        restartApp,
        mockUpdate
    };
}
