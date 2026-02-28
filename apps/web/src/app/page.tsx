'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MetricCard } from '@/components/ui/metric-card';
import { StatusBadge } from '@/components/ui/status-badge';
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

export default function DashboardPage() {
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
                    setError(err instanceof Error ? err.message : 'Unknown dashboard error');
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
    }, []);

    if (loading) return <div className="rounded-xl border border-white/10 bg-[#11141a] p-6 text-white/70">Loading dashboard...</div>;
    if (error) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">{error}</div>;
    if (!data) return null;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Dashboard</h1>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Total Deployments" value={data.summary.totalDeployments} />
                <MetricCard label="Success Rate" value={formatPercent(data.summary.successRate)} tone="success" />
                <MetricCard label="Failed CI Runs" value={data.summary.failedCiRuns} tone="danger" />
                <MetricCard label="Fix Success %" value={formatPercent(data.summary.fixSuccessPercentage)} tone="warning" />
            </section>

            <section className="overflow-hidden rounded-xl border border-white/10 bg-[#11141a]">
                <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-white">Recent Activity</div>
                <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-white/5 text-left text-white/70">
                            <tr>
                                <th className="px-4 py-3">Time</th>
                                <th className="px-4 py-3">Repository</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Message</th>
                                <th className="px-4 py-3">Deployment</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.recentActivity.map((item) => (
                                <tr key={item.id} className="border-t border-white/5 text-white/80">
                                    <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(item.created_at)}</td>
                                    <td className="px-4 py-3">{shortRepo(item.original_repo)}</td>
                                    <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                                    <td className="px-4 py-3 max-w-xl truncate">{item.message}</td>
                                    <td className="px-4 py-3">
                                        <Link className="text-cyan-300 hover:text-cyan-200" href={`/deployments/${item.deployment_id}`}>
                                            Open
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
