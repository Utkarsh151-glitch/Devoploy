'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDateTime, shortRepo } from '@/lib/ui';

type Deployment = {
    id: string;
    original_repo: string;
    target_cloud: string;
    status: any;
    updated_at: string;
    created_at: string;
};

type Response = {
    rows: Deployment[];
    total: number;
    page: number;
    pageSize: number;
};

const statuses = ['', 'queued', 'cloning', 'analyzing', 'fixing', 'pushing', 'completed', 'deploying', 'deployed', 'deployment_failed', 'failed'];

export default function DeploymentsPage() {
    const [data, setData] = useState<Response | null>(null);
    const [status, setStatus] = useState('');
    const [repo, setRepo] = useState('');
    const [newRepoUrl, setNewRepoUrl] = useState('');
    const [newTargetCloud, setNewTargetCloud] = useState('Vercel');
    const [creating, setCreating] = useState(false);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams();
                if (status) params.set('status', status);
                if (repo) params.set('repo', repo);
                params.set('page', String(page));
                params.set('pageSize', '15');
                const response = await fetch(`/api/deployments?${params.toString()}`, { cache: 'no-store' });
                const json = await response.json();
                if (!response.ok) throw new Error(json?.error || 'Failed to fetch deployments');
                if (!cancelled) {
                    setData(json);
                    setError('');
                }
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown deployments error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load().catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [status, repo, page]);

    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

    const createDeployment = async () => {
        if (!newRepoUrl.trim()) return;
        setCreating(true);
        setError('');
        try {
            const response = await fetch('/api/deploy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-idempotency-key': crypto.randomUUID(),
                },
                body: JSON.stringify({
                    repoUrl: newRepoUrl.trim(),
                    targetCloud: newTargetCloud,
                }),
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json?.error || 'Failed to create deployment');
            setNewRepoUrl('');
            setPage(1);
            const refresh = await fetch('/api/deployments?page=1&pageSize=15', { cache: 'no-store' });
            const refreshedJson = await refresh.json();
            if (refresh.ok) setData(refreshedJson);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to create deployment');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Deployments</h1>

            <section className="grid gap-3 rounded-xl border border-white/10 bg-[#11141a] p-4 md:grid-cols-5">
                <input
                    value={newRepoUrl}
                    onChange={(e) => setNewRepoUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="rounded-lg border border-white/10 bg-[#0f1218] px-3 py-2 text-sm text-white placeholder:text-white/40 md:col-span-3"
                />
                <select
                    value={newTargetCloud}
                    onChange={(e) => setNewTargetCloud(e.target.value)}
                    className="rounded-lg border border-white/10 bg-[#0f1218] px-3 py-2 text-sm text-white"
                >
                    <option value="Vercel">Vercel</option>
                    <option value="AWS">AWS</option>
                    <option value="Heroku">Heroku</option>
                    <option value="GCP">GCP</option>
                </select>
                <button
                    onClick={createDeployment}
                    disabled={creating || !newRepoUrl.trim()}
                    className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 disabled:opacity-40"
                >
                    {creating ? 'Creating...' : 'Create Deployment'}
                </button>
            </section>

            <section className="grid gap-3 rounded-xl border border-white/10 bg-[#11141a] p-4 md:grid-cols-3">
                <select
                    value={status}
                    onChange={(e) => {
                        setStatus(e.target.value);
                        setPage(1);
                    }}
                    className="rounded-lg border border-white/10 bg-[#0f1218] px-3 py-2 text-sm text-white"
                >
                    {statuses.map((s) => (
                        <option key={s || 'all'} value={s}>{s || 'all statuses'}</option>
                    ))}
                </select>
                <input
                    value={repo}
                    onChange={(e) => {
                        setRepo(e.target.value);
                        setPage(1);
                    }}
                    placeholder="Filter by repo"
                    className="rounded-lg border border-white/10 bg-[#0f1218] px-3 py-2 text-sm text-white placeholder:text-white/40"
                />
                <div className="text-sm text-white/60 self-center">Total: {data?.total ?? 0}</div>
            </section>

            {loading && <div className="rounded-xl border border-white/10 bg-[#11141a] p-6 text-white/70">Loading deployments...</div>}
            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">{error}</div>}

            {!loading && data && (
                <section className="overflow-hidden rounded-xl border border-white/10 bg-[#11141a]">
                    <div className="overflow-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-white/5 text-left text-white/70">
                                <tr>
                                    <th className="px-4 py-3">ID</th>
                                    <th className="px-4 py-3">Repo</th>
                                    <th className="px-4 py-3">Provider</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Updated</th>
                                    <th className="px-4 py-3"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((row) => (
                                    <tr key={row.id} className="border-t border-white/5 text-white/80">
                                        <td className="px-4 py-3 font-mono text-xs">{row.id.slice(0, 8)}...</td>
                                        <td className="px-4 py-3">{shortRepo(row.original_repo)}</td>
                                        <td className="px-4 py-3">{row.target_cloud}</td>
                                        <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                                        <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(row.updated_at)}</td>
                                        <td className="px-4 py-3">
                                            <Link href={`/deployments/${row.id}`} className="text-cyan-300 hover:text-cyan-200">Detail</Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-sm">
                        <button
                            className="rounded-md border border-white/15 px-3 py-1 text-white/80 disabled:opacity-40"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                            Previous
                        </button>
                        <span className="text-white/60">Page {page} / {totalPages}</span>
                        <button
                            className="rounded-md border border-white/15 px-3 py-1 text-white/80 disabled:opacity-40"
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                            Next
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
}
