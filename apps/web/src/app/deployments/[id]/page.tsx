'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { StatusBadge } from '@/components/ui/status-badge';
import { DiffViewer } from '@/components/ui/diff-viewer';
import { LogViewer } from '@/components/ui/log-viewer';
import { Modal } from '@/components/ui/modal';
import { formatDateTime, shortRepo } from '@/lib/ui';

const stages = ['queued', 'cloning', 'analyzing', 'fixing', 'pushing', 'deploying', 'deployed'] as const;

type DetailResponse = {
    deployment: any;
    logs: any[];
    analysis: any | null;
    diffPreview: string;
    fixApplied: string;
    aiDiffPreview: string;
    aiFixSummary: string;
    aiChangedFiles: string;
};

export default function DeploymentDetailPage() {
    const params = useParams<{ id: string }>();
    const id = params.id;
    const [data, setData] = useState<DetailResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retrying, setRetrying] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch(`/api/deployments/${id}`, { cache: 'no-store' });
                const json = await response.json();
                if (!response.ok) throw new Error(json?.error || 'Failed to fetch deployment detail');
                if (!cancelled) {
                    setData(json);
                    setError('');
                }
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown detail error');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load().catch(() => undefined);
        const poll = setInterval(() => {
            const status = data?.deployment?.status;
            if (status && ['deployed', 'failed', 'deployment_failed', 'completed'].includes(status)) return;
            load().catch(() => undefined);
        }, 3000);
        return () => {
            cancelled = true;
            clearInterval(poll);
        };
    }, [id, data?.deployment?.status]);

    const currentStageIndex = useMemo(() => {
        if (!data) return -1;
        const status = data.deployment.status;
        const idx = stages.indexOf(status);
        if (idx >= 0) return idx;
        if (status === 'completed') return stages.indexOf('deploying');
        if (status === 'deployment_failed') return stages.indexOf('deploying');
        if (status === 'failed') return 0;
        return -1;
    }, [data]);

    const handleRetry = async () => {
        setRetrying(true);
        try {
            const response = await fetch(`/api/deployments/${id}/retry`, { method: 'POST' });
            const json = await response.json();
            if (!response.ok) throw new Error(json?.error || 'Retry failed');
            const refreshed = await fetch(`/api/deployments/${id}`, { cache: 'no-store' }).then((r) => r.json());
            setData(refreshed);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Retry failed');
        } finally {
            setRetrying(false);
        }
    };

    const handleDeploy = async () => {
        setDeploying(true);
        setError('');
        try {
            const response = await fetch(`/api/deployments/${id}/deploy`, { method: 'POST' });
            const json = await response.json();
            if (!response.ok) throw new Error(json?.error || 'Deploy failed');
            const refreshed = await fetch(`/api/deployments/${id}`, { cache: 'no-store' }).then((r) => r.json());
            setData(refreshed);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Deploy failed');
        } finally {
            setDeploying(false);
        }
    };

    if (loading) return <div className="rounded-xl border border-white/10 bg-[#11141a] p-6 text-white/70">Loading deployment detail...</div>;
    if (error) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">{error}</div>;
    if (!data) return null;

    const { deployment, analysis } = data;
    const canRetry = ['failed', 'deployment_failed', 'queued'].includes(deployment.status);
    const canDeploy = ['completed', 'deployment_failed', 'deployed'].includes(deployment.status);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Deployment Detail</h1>
                    <p className="mt-1 text-sm text-white/60">{shortRepo(deployment.original_repo)}</p>
                </div>
                <div className="flex items-center gap-3">
                    <StatusBadge status={deployment.status} />
                    <a
                        href={`/api/deployments/${id}/report`}
                        className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
                    >
                        Download Report
                    </a>
                    <button
                        onClick={handleDeploy}
                        disabled={!canDeploy || deploying}
                        className="rounded-md border border-green-500/35 bg-green-500/10 px-3 py-1.5 text-sm text-green-200 disabled:opacity-40"
                    >
                        {deploying ? 'Deploying...' : 'Deploy'}
                    </button>
                    <button
                        onClick={handleRetry}
                        disabled={!canRetry || retrying}
                        className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-sm text-yellow-200 disabled:opacity-40"
                    >
                        {retrying ? 'Retrying...' : 'Retry'}
                    </button>
                </div>
            </div>

            <section className="rounded-xl border border-white/10 bg-[#11141a] p-4">
                <h2 className="mb-4 text-sm font-semibold text-white">Timeline</h2>
                <ol className="grid gap-3 md:grid-cols-7">
                    {stages.map((stage, idx) => {
                        const active = idx <= currentStageIndex;
                        return (
                            <li key={stage} className={`rounded-lg border px-3 py-2 text-center text-xs ${active ? 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200' : 'border-white/10 bg-[#0f1218] text-white/50'}`}>
                                {stage}
                            </li>
                        );
                    })}
                </ol>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-[#11141a] p-4">
                    <h2 className="mb-3 text-sm font-semibold text-white">Classification</h2>
                    {analysis ? (
                        <div className="space-y-2 text-sm text-white/80">
                            <p>Category: <span className="font-medium text-white">{analysis.category}</span></p>
                            <p>Fix Applied: <span className="font-medium text-white">{data.fixApplied || analysis.suggested_fix_type}</span></p>
                            <p>Confidence: <span className="font-medium text-white">{Math.round(Number(analysis.confidence) * 100)}%</span></p>
                            <p>Before CI Status: <span className="text-red-300">failed</span></p>
                            <p>After CI Status: <span className="text-green-300">{deployment.status}</span></p>
                            <p>Provider Status: <span className="font-medium text-white">{deployment.status}</span></p>
                            <p>AI Fix Pass: <span className="font-medium text-white">{data.aiFixSummary ? 'Applied' : 'Not applied'}</span></p>
                            {data.aiFixSummary ? (
                                <p>AI Summary: <span className="font-medium text-white">{data.aiFixSummary}</span></p>
                            ) : null}
                            {data.aiChangedFiles ? (
                                <p>AI Changed Files: <span className="font-medium text-white">{data.aiChangedFiles}</span></p>
                            ) : null}
                            <button onClick={() => setModalOpen(true)} className="mt-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
                                Error Explanation
                            </button>
                        </div>
                    ) : (
                        <p className="text-sm text-white/60">No CI analysis linked yet.</p>
                    )}
                </div>
                <div className="rounded-xl border border-white/10 bg-[#11141a] p-4">
                    <h2 className="mb-3 text-sm font-semibold text-white">Raw CI Error Snippet</h2>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[#0f1218] p-3 font-mono text-xs text-white/80">
                        {analysis?.original_log_snippet || 'No snippet available'}
                    </pre>
                </div>
            </section>

            <DiffViewer diff={data.diffPreview} />
            {data.aiDiffPreview ? <DiffViewer diff={data.aiDiffPreview} /> : null}
            <LogViewer logs={data.logs} />

            <section className="rounded-xl border border-white/10 bg-[#11141a] p-4 text-xs text-white/60">
                Updated: {formatDateTime(deployment.updated_at)} | Deployment ID: {deployment.id}
            </section>

            <Modal open={modalOpen} title="Error Explainability" onClose={() => setModalOpen(false)}>
                <p><strong>Rule Matched:</strong> {analysis?.rule_matched || 'N/A'}</p>
                <p className="mt-2"><strong>Why This Fix:</strong> {analysis?.why_this_fix || 'N/A'}</p>
            </Modal>
        </div>
    );
}
