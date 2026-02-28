'use client';

import { useState } from 'react';
import type { DeploymentLog } from 'database';
import { formatDateTime } from '@/lib/ui';

export function LogViewer({ logs }: { logs: DeploymentLog[] }) {
    const [open, setOpen] = useState(false);
    return (
        <section className="rounded-xl border border-white/10 bg-[#0f1218]">
            <button
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-white"
                onClick={() => setOpen((v) => !v)}
            >
                <span>Log Viewer ({logs.length})</span>
                <span className="text-white/60">{open ? 'Collapse' : 'Expand'}</span>
            </button>
            {open && (
                <div className="max-h-96 overflow-auto border-t border-white/10 px-4 py-3 font-mono text-xs">
                    {logs.map((log) => (
                        <div key={log.id} className="mb-2 text-white/75">
                            <span className="text-white/40">[{formatDateTime(log.created_at)}]</span>{' '}
                            <span className="text-white/60">{log.log_level}</span> {log.message}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
