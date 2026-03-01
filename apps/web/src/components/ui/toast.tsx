'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

type ToastTone = 'success' | 'warning' | 'error' | 'info';

type ToastItem = {
    id: string;
    title: string;
    description?: string;
    tone: ToastTone;
};

type ToastContextValue = {
    pushToast: (toast: Omit<ToastItem, 'id'>) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function iconForTone(tone: ToastTone) {
    if (tone === 'success') return CheckCircle2;
    if (tone === 'warning') return AlertTriangle;
    if (tone === 'error') return XCircle;
    return Info;
}

function classesForTone(tone: ToastTone): string {
    if (tone === 'success') return 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100';
    if (tone === 'warning') return 'border-amber-400/35 bg-amber-500/12 text-amber-100';
    if (tone === 'error') return 'border-rose-400/35 bg-rose-500/12 text-rose-100';
    return 'border-blue-400/35 bg-blue-500/12 text-blue-100';
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts((current) => current.filter((item) => item.id !== id));
    }, []);

    const pushToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
        const id = crypto.randomUUID();
        const item: ToastItem = { id, ...toast };
        setToasts((current) => [...current, item]);
        setTimeout(() => removeToast(id), 4200);
    }, [removeToast]);

    const context = useMemo(() => ({ pushToast }), [pushToast]);

    return (
        <ToastContext.Provider value={context}>
            {children}
            <div className="pointer-events-none fixed right-4 top-4 z-[90] space-y-2">
                <AnimatePresence>
                    {toasts.map((toast) => {
                        const Icon = iconForTone(toast.tone);
                        return (
                            <motion.div
                                key={toast.id}
                                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                className={`pointer-events-auto w-80 rounded-xl border px-3 py-3 shadow-2xl ${classesForTone(toast.tone)}`}
                            >
                                <div className="flex items-start gap-2">
                                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-medium">{toast.title}</p>
                                        {toast.description ? <p className="text-xs opacity-85">{toast.description}</p> : null}
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const value = useContext(ToastContext);
    if (!value) {
        throw new Error('useToast must be used inside ToastProvider');
    }
    return value;
}
