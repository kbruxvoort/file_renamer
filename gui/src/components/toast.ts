export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
    id: number;
    kind: ToastKind;
    message: string;
}

export type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];

export function currentToasts(): Toast[] {
    return toasts;
}
let nextId = 1;
export const listeners = new Set<Listener>();

function emit() {
    listeners.forEach(l => l(toasts));
}

export function dismiss(id: number) {
    toasts = toasts.filter(t => t.id !== id);
    emit();
}

/** Shows a non-blocking notification. Errors stay until dismissed. */
export function toast(message: string, kind: ToastKind = 'info') {
    const id = nextId++;
    toasts = [...toasts, { id, kind, message }];
    emit();
    if (kind !== 'error') setTimeout(() => dismiss(id), 4000);
}

