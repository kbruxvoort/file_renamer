import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, FileUp } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface FilePickerProps {
    currentPath: string | null; // For display only now
    onPathSelect: (paths: string[]) => void; // Changed to array
    className?: string;
    customButton?: React.ReactNode;
    type?: 'file' | 'folder';
}

export function FilePicker({ currentPath, onPathSelect, className, customButton, type = 'folder' }: FilePickerProps) {

    async function handleBrowse() {
        try {
            const selected = await open({
                directory: type === 'folder',
                multiple: type === 'file', // Allow multiple files, but folders usually single
                title: type === 'folder' ? "Select Source Directory" : "Select Media Files"
            });

            if (selected) {
                if (Array.isArray(selected)) {
                    onPathSelect(selected);
                } else {
                    onPathSelect([selected]);
                }
            }
        } catch (err) {
            console.error("Failed to open dialog:", err);
        }
    }

    if (customButton) {
        return (
            <div onClick={handleBrowse} className={className}>
                {customButton}
            </div>
        );
    }

    return (
        <div className={twMerge("w-full", className)}>
            <div
                onClick={handleBrowse}
                className={clsx(
                    "border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer group",
                    "flex flex-col items-center justify-center gap-4",
                    currentPath
                        ? "border-green-500/50 bg-green-900/10 hover:bg-green-900/20"
                        : "border-gray-600 bg-gray-800/50 hover:border-blue-500 hover:bg-blue-900/10"
                )}
            >
                <div className={clsx(
                    "p-4 rounded-full transition-colors",
                    currentPath ? "bg-green-500/20 text-green-400" : "bg-gray-700 group-hover:bg-blue-500/20 group-hover:text-blue-400"
                )}>
                    {type === 'folder' ? (
                        currentPath ? <FolderOpen size={32} /> : <FileUp size={32} />
                    ) : (
                        <FileUp size={32} />
                    )}
                </div>

                <div className="text-center">
                    <h3 className="text-lg font-semibold text-white">
                        {currentPath
                            ? (type === 'folder' ? "Source Selected" : "Files Selected")
                            : (type === 'folder' ? "Select Media Directory" : "Select Files")
                        }
                    </h3>
                    <p className="text-sm text-gray-400 mt-1 max-w-md truncate">
                        {currentPath || (type === 'folder' ? "Click to browse folders" : "Click to select files")}
                    </p>
                </div>
            </div>
        </div>
    );
}
