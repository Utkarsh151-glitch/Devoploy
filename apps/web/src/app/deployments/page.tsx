'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
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
    const { pushToast } = useToast();
    const [data, setData] = useState<Response | null>(null);
    const [status, setStatus] = useState('');
    const [repo, setRepo] = useState('');
    const [newRepoUrl, setNewRepoUrl] = useState('');
    const [newTargetCloud, setNewTargetCloud] = useState('Vercel');
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
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
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : 'Unknown deployments error';
                    setError(message);
                    pushToast({ tone: 'error', title: 'Deployments load failed', description: message });
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load().catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [status, repo, page, pushToast]);

    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
    const hasRows = Boolean(data?.rows?.length);

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
            pushToast({ tone: 'success', title: 'Deployment queued', description: json.deploymentId });
            const refresh = await fetch('/api/deployments?page=1&pageSize=15', { cache: 'no-store' });
            const refreshedJson = await refresh.json();
            if (refresh.ok) setData(refreshedJson);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create deployment';
            setError(message);
            pushToast({ tone: 'error', title: 'Create deployment failed', description: message });
        } finally {
            setCreating(false);
        }
    };

    const deleteDeployment = async (id: string, repoUrl: string) => {
        const ok = window.confirm(`Delete deployment for ${repoUrl}?\nThis will remove logs and report history.`);
        if (!ok) return;

        setDeletingId(id);
        setError('');
        try {
            const response = await fetch(`/api/deployments/${id}`, { method: 'DELETE' });
            const json = await response.json();
            if (!response.ok) throw new Error(json?.error || 'Failed to delete deployment');

            pushToast({ tone: 'success', title: 'Deployment deleted', description: id });

            const params = new URLSearchParams();
            if (status) params.set('status', status);
            if (repo) params.set('repo', repo);
            params.set('page', String(page));
            params.set('pageSize', '15');
            const refresh = await fetch(`/api/deployments?${params.toString()}`, { cache: 'no-store' });
            const refreshedJson = await refresh.json();
            if (refresh.ok) setData(refreshedJson);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to delete deployment';
            setError(message);
            pushToast({ tone: 'error', title: 'Delete failed', description: message });
        } finally {
            setDeletingId(null);
        }
    };

    const emptyState = useMemo(() => {
        if (loading) return 'Loading deployments...';
        if (error) return error;
        return 'No deployments found for current filters.';
    }, [error, loading]);

    return (
        <div className="space-y-6">
            <div className="flex items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
                    <p className="mt-1 text-sm text-white/55">Track every stage from queue to production deploy.</p>
                </div>
            </div>

            <section className="rounded-2xl border border-white/10 bg-[#0d1324]/80 p-4">
                <div className="grid gap-3 md:grid-cols-5">
                    <input
                        value={newRepoUrl}
                        onChange={(e) => setNewRepoUrl(e.target.value)}
                        placeholder="https://github.com/owner/repo"
                        className="focus-ring rounded-lg border border-white/10 bg-[#091024] px-3 py-2 text-sm text-white placeholder:text-white/40 md:col-span-3"
                    />
                    <select
                        value={newTargetCloud}
                        onChange={(e) => setNewTargetCloud(e.target.value)}
                        className="focus-ring rounded-lg border border-white/10 bg-[#091024] px-3 py-2 text-sm text-white"
                    >
                        <option value="Vercel">Vercel</option>
                        <option value="AWS">AWS</option>
                        <option value="Heroku">Heroku</option>
                        <option value="GCP">GCP</option>
                    </select>
                    <button
                        onClick={createDeployment}
                        disabled={creating || !newRepoUrl.trim()}
                        className="rounded-lg border border-blue-400/35 bg-gradient-to-r from-blue-500/30 to-cyan-500/25 px-3 py-2 text-sm font-medium text-blue-100 disabled:opacity-40"
                    >
                        {creating ? 'Creating...' : 'Create Deployment'}
                    </button>
                </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#0d1324]/80 p-4">
                <div className="grid gap-3 md:grid-cols-3">
                    <select
                        value={status}
                        onChange={(e) => {
                            setStatus(e.target.value);
                            setPage(1);
                        }}
                        className="focus-ring rounded-lg border border-white/10 bg-[#091024] px-3 py-2 text-sm text-white"
                    >
                        {statuses.map((item) => (
                            <option key={item || 'all'} value={item}>{item || 'all statuses'}</option>
                        ))}
                    </select>
                    <input
                        value={repo}
                        onChange={(e) => {
                            setRepo(e.target.value);
                            setPage(1);
                        }}
                        placeholder="Filter by repository"
                        className="focus-ring rounded-lg border border-white/10 bg-[#091024] px-3 py-2 text-sm text-white placeholder:text-white/40"
                    />
                    <div className="rounded-lg border border-white/10 bg-[#091024] px-3 py-2 text-sm text-white/70">Total: {data?.total ?? 0}</div>
                </div>
            </section>

            <DataTable
                rows={data?.rows || []}
                emptyText={emptyState}
                columns={[
                    {
                        id: 'id',
                        label: 'Deployment',
                        sortable: true,
                        sortValue: (row) => row.id,
                        render: (row) => <span className="font-mono text-xs text-white/70">{row.id.slice(0, 12)}...</span>,
                    },
                    {
                        id: 'repo',
                        label: 'Repository',
                        sortable: true,
                        sortValue: (row) => shortRepo(row.original_repo),
                        render: (row) => shortRepo(row.original_repo),
                    },
                    {
                        id: 'provider',
                        label: 'Provider',
                        sortable: true,
                        sortValue: (row) => row.target_cloud,
                        render: (row) => <span className="text-white/70">{row.target_cloud}</span>,
                    },
                    {
                        id: 'status',
                        label: 'Status',
                        render: (row) => <StatusBadge status={row.status} />,
                    },
                    {
                        id: 'updated',
                        label: 'Updated',
                        sortable: true,
                        sortValue: (row) => new Date(row.updated_at).getTime(),
                        render: (row) => <span className="whitespace-nowrap text-white/70">{formatDateTime(row.updated_at)}</span>,
                    },
                    {
                        id: 'actions',
                        label: 'Actions',
                        className: 'text-right',
                        render: (row) => (
                            <div className="flex items-center justify-end gap-3">
                                <Link href={`/deployments/${row.id}`} className="text-blue-300 hover:text-blue-200">Details</Link>
                                <button
                                    onClick={() => deleteDeployment(row.id, row.original_repo)}
                                    disabled={deletingId === row.id}
                                    className="text-rose-300 hover:text-rose-200 disabled:opacity-40"
                                >
                                    {deletingId === row.id ? 'Deleting...' : 'Delete'}
                                </button>
                            </div>
                        ),
                    },
                ]}
                renderExpanded={(row) => (
                    <div className="grid gap-2 text-xs text-white/70 md:grid-cols-2">
                        <p><span className="text-white/50">Created:</span> {formatDateTime(row.created_at)}</p>
                        <p><span className="text-white/50">Updated:</span> {formatDateTime(row.updated_at)}</p>
                        <p className="md:col-span-2"><span className="text-white/50">Repository URL:</span> {row.original_repo}</p>
                    </div>
                )}
            />

            {hasRows ? (
                <div className="flex items-center justify-between text-sm">
                    <button
                        className="rounded-lg border border-white/10 bg-[#0d1324]/80 px-3 py-1.5 text-white/80 disabled:opacity-40"
                        disabled={page <= 1}
                        onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                        Previous
                    </button>
                    <span className="text-white/55">Page {page} / {totalPages}</span>
                    <button
                        className="rounded-lg border border-white/10 bg-[#0d1324]/80 px-3 py-1.5 text-white/80 disabled:opacity-40"
                        disabled={page >= totalPages}
                        onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    >
                        Next
                    </button>
                </div>
            ) : null}
        </div>
    );
}
