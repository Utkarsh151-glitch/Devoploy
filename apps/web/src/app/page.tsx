'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MetricCard } from '@/components/ui/metric-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, formatPercent, shortRepo } from '@/lib/ui';

type Activity = {
    id: string;
    deployment_id: string;
    original_repo: string;
    status: any;
    message: string;
    log_level: string;
    created_at: string;
};

type DashboardResponse = {
    summary: {
        totalDeployments: number;
        successRate: number;
        failedCiRuns: number;
        fixSuccessPercentage: number;
    };
    recentActivity: Activity[];
};

function buildSparkline(base: number, activitySize: number): number[] {
    const start = Math.max(2, Math.floor(base / 4) || 2);
    return [start, start + 1, start + 2, Math.max(1, start + activitySize % 4), start + 3, start + 2, start + 4];
}

export default function DashboardPage() {
    const { pushToast } = useToast();
    const [data, setData] = useState<DashboardResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch('/api/dashboard', { cache: 'no-store' });
                const json = await response.json();
                if (!response.ok) throw new Error(json?.error || 'Failed to fetch dashboard');
                if (!cancelled) {
                    setData(json);
                    setError('');
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : 'Unknown dashboard error';
                    setError(message);
                    pushToast({ tone: 'error', title: 'Dashboard error', description: message });
                }
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
    }, [pushToast]);

    const cards = useMemo(() => {
        if (!data) return [];
        const count = data.recentActivity.length;
        return [
            {
                label: 'Total Deployments',
                value: data.summary.totalDeployments,
                tone: 'info' as const,
                trend: 9,
                sparkline: buildSparkline(data.summary.totalDeployments, count),
            },
            {
                label: 'Success Rate',
                value: formatPercent(data.summary.successRate),
                tone: 'success' as const,
                trend: 6,
                sparkline: buildSparkline(Math.round(data.summary.successRate), count),
            },
            {
                label: 'Failed CI Runs',
                value: data.summary.failedCiRuns,
                tone: 'error' as const,
                trend: -3,
                sparkline: buildSparkline(data.summary.failedCiRuns + 2, count),
            },
            {
                label: 'Fix Success',
                value: formatPercent(data.summary.fixSuccessPercentage),
                tone: 'warning' as const,
                trend: 4,
                sparkline: buildSparkline(Math.round(data.summary.fixSuccessPercentage), count),
            },
        ];
    }, [data]);

    if (loading) return <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-white/70">Loading dashboard...</div>;
    if (error) return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-200">{error}</div>;
    if (!data) return null;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">DevOps Intelligence</h1>
                <p className="mt-1 text-sm text-white/55">Real-time deployment health, CI failures, and automated fixes.</p>
            </div>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {cards.map((card) => (
                    <MetricCard
                        key={card.label}
                        label={card.label}
                        value={card.value}
                        tone={card.tone}
                        trend={card.trend}
                        sparkline={card.sparkline}
                    />
                ))}
            </section>

            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/60">Recent Activity</h2>
                </div>
                <DataTable
                    rows={data.recentActivity}
                    columns={[
                        {
                            id: 'time',
                            label: 'Time',
                            sortable: true,
                            sortValue: (row) => new Date(row.created_at).getTime(),
                            render: (row) => <span className="whitespace-nowrap text-white/70">{formatDateTime(row.created_at)}</span>,
                        },
                        {
                            id: 'repo',
                            label: 'Repository',
                            sortable: true,
                            sortValue: (row) => shortRepo(row.original_repo),
                            render: (row) => <span>{shortRepo(row.original_repo)}</span>,
                        },
                        {
                            id: 'status',
                            label: 'Status',
                            render: (row) => <StatusBadge status={row.status} />,
                        },
                        {
                            id: 'message',
                            label: 'Message',
                            render: (row) => <span className="line-clamp-1 text-white/75">{row.message}</span>,
                        },
                        {
                            id: 'open',
                            label: 'Open',
                            className: 'text-right',
                            render: (row) => (
                                <Link href={`/deployments/${row.deployment_id}`} className="text-blue-300 hover:text-blue-200">
                                    View
                                </Link>
                            ),
                        },
                    ]}
                    renderExpanded={(row) => (
                        <div className="space-y-1 text-xs text-white/70">
                            <p><span className="text-white/50">Level:</span> {row.log_level}</p>
                            <p><span className="text-white/50">Deployment:</span> {row.deployment_id}</p>
                            <p className="whitespace-pre-wrap rounded-lg border border-white/10 bg-[#090f1f] p-3">{row.message}</p>
                        </div>
                    )}
                />
            </section>
        </div>
    );
}
