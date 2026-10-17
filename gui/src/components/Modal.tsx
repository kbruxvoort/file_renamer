import { useEffect, useRef, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: ReactNode;
    subtitle?: ReactNode;
    icon?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
    size?: 'md' | 'lg' | 'xl';
    dismissable?: boolean;  // false while work is in progress
}

/** Shared dialog shell: backdrop, Esc to close, focus moved into the dialog. */
export function Modal({ isOpen, onClose, title, subtitle, icon, children, footer, size = 'lg', dismissable = true }: ModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        dialogRef.current?.focus();
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && dismissable) onClose();
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, dismissable, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={dismissable ? onClose : undefined} />
            <div
                ref={dialogRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                className={clsx(
                    "relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full flex flex-col max-h-[85vh] outline-none animate-fade-in",
                    size === 'md' && "max-w-lg",
                    size === 'lg' && "max-w-3xl",
                    size === 'xl' && "max-w-5xl",
                )}
            >
                <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        {icon}
                        <div className="min-w-0">
                            <h2 className="text-lg font-semibold text-white">{title}</h2>
                            {subtitle && <div className="text-xs text-gray-400 truncate">{subtitle}</div>}
                        </div>
                    </div>
                    {dismissable && (
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white" aria-label="Close">
                            <X size={20} />
                        </button>
                    )}
                </div>
                <div className="flex-1 overflow-y-auto p-6">{children}</div>
                {footer && <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-end gap-3 bg-gray-900/50 rounded-b-2xl">{footer}</div>}
            </div>
        </div>
    );
}
