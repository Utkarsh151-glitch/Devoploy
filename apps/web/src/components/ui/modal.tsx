'use client';

import type { ReactNode } from 'react';

export function Modal({
    open,
    title,
    onClose,
    children,
}: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-xl rounded-xl border border-white/15 bg-[#11141a]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                    <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>Close</button>
                </div>
                <div className="p-4 text-sm text-white/80">{children}</div>
            </div>
        </div>
    );
}
