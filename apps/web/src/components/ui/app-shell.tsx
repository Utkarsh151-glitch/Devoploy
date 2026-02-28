import Link from 'next/link';
import type { ReactNode } from 'react';

const nav = [
    { href: '/', label: 'Dashboard' },
    { href: '/deployments', label: 'Deployments' },
    { href: '/repos', label: 'Repositories' },
    { href: '/docs', label: 'Documentation' },
    { href: '/settings', label: 'Settings' },
];

export function AppShell({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen bg-[#0b0f14] text-white">
            <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0f14]/90 backdrop-blur">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
                    <Link href="/" className="text-lg font-semibold tracking-wide text-white">DevOps Intelligence</Link>
                    <nav className="flex gap-2 text-sm">
                        {nav.map((item) => (
                            <Link key={item.href} href={item.href} className="rounded-md px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white">
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>
            </header>
            <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </div>
    );
}
