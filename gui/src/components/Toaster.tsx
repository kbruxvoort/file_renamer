import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

import { currentToasts, dismiss, listeners, type Toast } from './toast';

export function Toaster() {
    const [items, setItems] = useState<Toast[]>(currentToasts);

    useEffect(() => {
        listeners.add(setItems);
        return () => { listeners.delete(setItems); };
    }, []);

    return (
        <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)]" role="status" aria-live="polite">
            {items.map(t => {
                const Icon = t.kind === 'success' ? CheckCircle : t.kind === 'error' ? AlertTriangle : Info;
                return (
                    <div
                        key={t.id}
                        className={clsx(
                            "flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border backdrop-blur-md text-sm animate-fade-in",
                            t.kind === 'success' && "bg-green-900/80 border-green-800 text-green-100",
                            t.kind === 'error' && "bg-red-900/80 border-red-800 text-red-100",
                            t.kind === 'info' && "bg-gray-800/90 border-gray-700 text-gray-100",
                        )}
                    >
                        <Icon size={18} className="shrink-0 mt-0.5" />
                        <p className="flex-1 whitespace-pre-line">{t.message}</p>
                        <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
                            <X size={16} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
