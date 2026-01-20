import { useState, useEffect, useCallback } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'up-to-date' | 'error';

interface UseUpdaterReturn {
    status: UpdateStatus;
    updateAvailable: Update | null;
    downloadProgress: number; // 0-100
    downloadedBytes: number;
    totalBytes: number;
    error: string | null;
    checkUpdate: (silent?: boolean) => Promise<void>;
    installUpdate: () => Promise<void>;
    mockUpdate: () => void; // Trigger for testing
}

export function useUpdater(): UseUpdaterReturn {
    const [status, setStatus] = useState<UpdateStatus>('idle');
    const [updateAvailable, setUpdateAvailable] = useState<Update | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadedBytes, setDownloadedBytes] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const [error, setError] = useState<string | null>(null);

    // Use ref to track total bytes in callback without closure staleness
    const totalBytesRef = useState<{ value: number }>({ value: 0 })[0];

    // Track if we are mocking to prevent real relaunch
    const [isMocking, setIsMocking] = useState(false);

    const checkUpdate = useCallback(async (silent = false) => {
        if (!silent) setStatus('checking');
        setError(null);
        setIsMocking(false);

        try {
            const update = await check();
            if (update && update.available) {
                setUpdateAvailable(update);
                setStatus('available');
            } else {
                setUpdateAvailable(null);
                if (!silent) setStatus('up-to-date');
                // Reset to idle after a moment if just checking
                if (!silent) setTimeout(() => setStatus('idle'), 3000);
            }
        } catch (e: any) {
            console.error("Update check failed:", e);
            if (!silent) {
                setError(e.message || "Failed to check for updates");
                setStatus('error');
            }
        }
    }, []);

    const installUpdate = useCallback(async () => {
        if (!updateAvailable) return;

        setStatus('downloading');
        setDownloadProgress(0);
        setError(null);
        totalBytesRef.value = 0; // Reset ref

        try {
            await updateAvailable.downloadAndInstall((event) => {
                if (event.event === 'Started') {
                    const total = event.data.contentLength || 0;
                    setTotalBytes(total);
                    totalBytesRef.value = total;
                    setDownloadedBytes(0);
                } else if (event.event === 'Progress') {
                    setDownloadedBytes(prev => {
                        const newBytes = prev + event.data.chunkLength;
                        if (totalBytesRef.value > 0) {
                            setDownloadProgress((newBytes / totalBytesRef.value) * 100);
                        }
                        return newBytes;
                    });
                } else if (event.event === 'Finished') {
                    setStatus('installing');
                    setDownloadProgress(100);
                }
            });

            // Relaunch only if real update (or if we want to test relaunch failure in dev)
            // But for mock, we should just alert.
            if (!isMocking) {
                await relaunch();
            } else {
                // Mock cleanup
                alert("Update Complete! App would restart now.");
                setStatus('idle');
                setUpdateAvailable(null);
                setIsMocking(false);
            }

        } catch (e: any) {
            console.error("Update installation failed:", e);
            setError(e.message || "Failed to install update");
            setStatus('error');
        }
    }, [updateAvailable, isMocking]);

    // Mock function for testing
    const mockUpdate = useCallback(() => {
        setIsMocking(true);
        // Pseudo-Update Object
        const mockObj = {
            available: true,
            version: "0.2.0-beta",
            currentVersion: "0.1.6",
            date: new Date().toISOString(),
            body: "## Amazing New Features\n- Better UI\n- Faster Scanning\n- Bug Fixes\n\nThis is a mock update for testing.",
            downloadAndInstall: (cb: any) => {
                // Return a Promise that resolves when "download" finishes
                return new Promise<void>((resolve) => {
                    const total = 100 * 1024 * 1024; // 100MB
                    cb({ event: 'Started', data: { contentLength: total } });

                    let current = 0;
                    const chunk = 2 * 1024 * 1024; // 2MB chunks (slower for visibility)

                    const interval = setInterval(() => {
                        current += chunk;
                        if (current <= total) {
                            cb({ event: 'Progress', data: { chunkLength: chunk } });
                        } else {
                            clearInterval(interval);
                            cb({ event: 'Finished' });
                            setTimeout(resolve, 1000); // Wait a bit then resolve
                        }
                    }, 100);
                });
            }
        } as unknown as Update;

        setUpdateAvailable(mockObj);
        setStatus('available');
    }, []);

    // Initial check
    useEffect(() => {
        checkUpdate(true);
    }, [checkUpdate]);

    return {
        status,
        updateAvailable,
        downloadProgress,
        downloadedBytes,
        totalBytes,
        error,
        checkUpdate,
        installUpdate,
        mockUpdate
    };
}
