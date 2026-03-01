'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Listbox } from '@headlessui/react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Bell,
    ChevronDown,
    LayoutDashboard,
    Rocket,
    FolderKanban,
    FileText,
    Settings,
    PanelLeftClose,
    PanelLeftOpen,
} from 'lucide-react';

const nav = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/deployments', label: 'Deployments', icon: Rocket },
    { href: '/repos', label: 'Repositories', icon: FolderKanban },
    { href: '/docs', label: 'Documentation', icon: FileText },
    { href: '/settings', label: 'Settings', icon: Settings },
];

const environments = ['Production', 'Staging', 'Development'];

export function AppShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const [selectedEnv, setSelectedEnv] = useState(environments[0]);
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="min-h-screen text-white">
            <div className="flex">
                <aside className={`sticky top-0 h-screen border-r border-white/10 bg-[#090f1f]/90 px-3 py-4 transition-all ${collapsed ? 'w-20' : 'w-64'}`}>
                    <div className="mb-6 flex items-center justify-between px-2">
                        <div className={`overflow-hidden transition-all ${collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                            <p className="text-xs uppercase tracking-[0.18em] text-white/45">Devoploy</p>
                            <p className="text-base font-semibold">Intelligence</p>
                        </div>
                        <button
                            onClick={() => setCollapsed((value) => !value)}
                            className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/70 hover:text-white"
                        >
                            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                        </button>
                    </div>

                    <nav className="space-y-1">
                        {nav.map((item) => {
                            const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                                        active
                                            ? 'bg-gradient-to-r from-blue-500/25 via-cyan-500/10 to-transparent text-white'
                                            : 'text-white/65 hover:bg-white/5 hover:text-white'
                                    }`}
                                >
                                    <Icon className="h-4 w-4 shrink-0" />
                                    <span className={`text-sm ${collapsed ? 'hidden' : 'block'}`}>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </aside>

                <div className="min-w-0 flex-1">
                    <header className="glass-nav sticky top-0 z-20">
                        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-3 md:px-6">
                            <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-white/45">Environment</p>
                                <Listbox value={selectedEnv} onChange={setSelectedEnv}>
                                    <div className="relative mt-1">
                                        <Listbox.Button className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/85">
                                            {selectedEnv}
                                            <ChevronDown className="h-4 w-4 text-white/60" />
                                        </Listbox.Button>
                                        <Listbox.Options className="absolute z-30 mt-2 w-40 rounded-xl border border-white/10 bg-[#0b1123] p-1 shadow-2xl">
                                            {environments.map((env) => (
                                                <Listbox.Option
                                                    key={env}
                                                    value={env}
                                                    className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/75 ui-active:bg-white/10 ui-active:text-white"
                                                >
                                                    {env}
                                                </Listbox.Option>
                                            ))}
                                        </Listbox.Options>
                                    </div>
                                </Listbox>
                            </div>
                            <button className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 hover:text-white">
                                <Bell className="h-4 w-4" />
                            </button>
                        </div>
                    </header>

                    <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-6">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={pathname}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.2 }}
                            >
                                {children}
                            </motion.div>
                        </AnimatePresence>
                    </main>
                </div>
            </div>
        </div>
    );
}
