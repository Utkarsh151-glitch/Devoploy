'use client';

import { useEffect, useState } from 'react';

type HealthResponse = {
    envChecks: Record<string, boolean>;
    database: { ok: boolean; error?: string };
    redis: { ok: boolean; error?: string };
    worker: { ok: boolean; activeWorkers: number; waitingJobs: number; activeJobs: number; failedJobs: number };
    githubApp: { ok: boolean; webhookUrl: string; error?: string };
};

function Dot({ ok }: { ok: boolean }) {
    return <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-green-400' : 'bg-red-400'}`} />;
}

export default function SettingsPage() {
    const [health, setHealth] = useState<HealthResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch('/api/settings/health', { cache: 'no-store' });
                const json = await response.json();
                if (!response.ok) throw new Error(json?.error || 'Failed to fetch health');
                if (!cancelled) {
                    setHealth(json);
                    setError('');
                }
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown settings error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load().catch(() => undefined);
        const id = setInterval(() => load().catch(() => undefined), 5000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    if (loading) return <div className="rounded-xl border border-white/10 bg-[#11141a] p-6 text-white/70">Loading settings...</div>;
    if (error) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">{error}</div>;
    if (!health) return null;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Settings</h1>

            <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-[#11141a] p-4">
                    <h2 className="mb-3 text-sm font-semibold">GitHub App Status</h2>
                    <div className="space-y-2 text-sm text-white/80">
                        <p className="flex items-center gap-2"><Dot ok={health.githubApp.ok} /> {health.githubApp.ok ? 'Connected' : 'Not Ready'}</p>
                        <p>Webhook URL: <code className="text-white">{health.githubApp.webhookUrl}</code></p>
                        {health.githubApp.error && <p className="text-red-300">{health.githubApp.error}</p>}
                    </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#11141a] p-4">
                    <h2 className="mb-3 text-sm font-semibold">Environment Variables</h2>
                    <ul className="space-y-2 text-sm text-white/80">
                        {Object.entries(health.envChecks).map(([key, ok]) => (
                            <li key={key} className="flex items-center gap-2"><Dot ok={ok} /> {key}</li>
                        ))}
                    </ul>
                </div>
            </section>

            <section className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-[#11141a] p-4 text-sm text-white/80">
                    <h2 className="mb-3 text-sm font-semibold">Database</h2>
                    <p className="flex items-center gap-2"><Dot ok={health.database.ok} /> {health.database.ok ? 'Connected' : 'Unavailable'}</p>
                    {health.database.error && <p className="mt-2 text-red-300">{health.database.error}</p>}
                </div>
                <div className="rounded-xl border border-white/10 bg-[#11141a] p-4 text-sm text-white/80">
                    <h2 className="mb-3 text-sm font-semibold">Redis</h2>
                    <p className="flex items-center gap-2"><Dot ok={health.redis.ok} /> {health.redis.ok ? 'Connected' : 'Unavailable'}</p>
                    {health.redis.error && <p className="mt-2 text-red-300">{health.redis.error}</p>}
                </div>
                <div className="rounded-xl border border-white/10 bg-[#11141a] p-4 text-sm text-white/80">
                    <h2 className="mb-3 text-sm font-semibold">Worker</h2>
                    <p className="flex items-center gap-2"><Dot ok={health.worker.ok} /> {health.worker.ok ? 'Online' : 'No active workers'}</p>
                    <p className="mt-2 text-white/60">Active workers: {health.worker.activeWorkers}</p>
                    <p className="text-white/60">Waiting jobs: {health.worker.waitingJobs}</p>
                    <p className="text-white/60">Active jobs: {health.worker.activeJobs}</p>
                    <p className="text-white/60">Failed jobs: {health.worker.failedJobs}</p>
                </div>
            </section>
        </div>
    );
}
