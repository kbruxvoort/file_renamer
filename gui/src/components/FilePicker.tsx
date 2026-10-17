import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, FileUp } from 'lucide-react';

interface FilePickerProps {
    onPathSelect: (paths: string[]) => void;
    label: string;
    type?: 'file' | 'folder';
}

/** Button that opens the native folder/file picker. */
export function FilePicker({ onPathSelect, label, type = 'folder' }: FilePickerProps) {
    async function handleBrowse() {
        try {
            const selected = await open({
                directory: type === 'folder',
                multiple: true,
                title: type === 'folder' ? "Select Source Folders" : "Select Media Files"
            });

            if (selected) {
                onPathSelect(Array.isArray(selected) ? selected : [selected]);
            }
        } catch (err) {
            console.error("Failed to open dialog:", err);
        }
    }

    const Icon = type === 'folder' ? FolderOpen : FileUp;

    return (
        <button
            type="button"
            onClick={handleBrowse}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors w-full"
        >
            <Icon size={20} />
            {label}
        </button>
    );
}
