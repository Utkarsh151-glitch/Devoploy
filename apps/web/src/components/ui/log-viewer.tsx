'use client';

import { Disclosure } from '@headlessui/react';
import { ChevronDown } from 'lucide-react';
import type { DeploymentLog } from 'database';
import { formatDateTime } from '@/lib/ui';

export function LogViewer({ logs }: { logs: DeploymentLog[] }) {
    return (
        <Disclosure as="section" className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1324]/80" defaultOpen={false}>
            {({ open }) => (
                <>
                    <Disclosure.Button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-white">
                        <span>Log Viewer ({logs.length})</span>
                        <ChevronDown className={`h-4 w-4 text-white/60 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </Disclosure.Button>
                    <Disclosure.Panel className="max-h-96 overflow-auto border-t border-white/10 bg-[#090f1f] px-4 py-3 font-mono text-xs">
                        {logs.map((log) => (
                            <div key={log.id} className="mb-2 rounded bg-white/[0.02] p-2 text-white/75">
                                <span className="text-white/40">[{formatDateTime(log.created_at)}]</span>{' '}
                                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">{log.log_level}</span>{' '}
                                {log.message}
                            </div>
                        ))}
                    </Disclosure.Panel>
                </>
            )}
        </Disclosure>
    );
}
