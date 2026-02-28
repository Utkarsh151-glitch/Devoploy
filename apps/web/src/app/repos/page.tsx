'use client';

import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDateTime, shortRepo } from '@/lib/ui';

type RepoRow = {
    repo: string;
    lastDeploymentId: string;
    lastStatus: any;
    lastUpdatedAt: string;
    totalDeployments: number;
};

export default function RepositoriesPage() {
    const [repos, setRepos] = useState<RepoRow[]>([]);
    const [installUrl, setInstallUrl] = useState('https://github.com/settings/apps');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch('/api/repos', { cache: 'no-store' });
                const json = await response.json();
                if (!response.ok) throw new Error(json?.error || 'Failed to fetch repos');
                if (!cancelled) {
                    setRepos(json.repos ?? []);
                    setInstallUrl(json.githubAppInstallUrl || installUrl);
                }
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown repos error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load().catch(() => undefined);
    }, [installUrl]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">Repositories</h1>
                <a
                    href={installUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200"
                >
                    Install GitHub App
                </a>
            </div>

            {loading && <div className="rounded-xl border border-white/10 bg-[#11141a] p-6 text-white/70">Loading repositories...</div>}
            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">{error}</div>}

            {!loading && !error && (
                <section className="overflow-hidden rounded-xl border border-white/10 bg-[#11141a]">
                    <div className="overflow-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-white/5 text-left text-white/70">
                                <tr>
                                    <th className="px-4 py-3">Repository</th>
                                    <th className="px-4 py-3">Last Status</th>
                                    <th className="px-4 py-3">Last Updated</th>
                                    <th className="px-4 py-3">Deployments</th>
                                </tr>
                            </thead>
                            <tbody>
                                {repos.map((row) => (
                                    <tr key={row.lastDeploymentId} className="border-t border-white/5 text-white/80">
                                        <td className="px-4 py-3">{shortRepo(row.repo)}</td>
                                        <td className="px-4 py-3"><StatusBadge status={row.lastStatus} /></td>
                                        <td className="px-4 py-3">{formatDateTime(row.lastUpdatedAt)}</td>
                                        <td className="px-4 py-3">{row.totalDeployments}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </div>
    );
}
