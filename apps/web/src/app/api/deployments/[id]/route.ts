import { NextResponse } from 'next/server';
import {
    deleteDeploymentById,
    getDeploymentById,
    getDeploymentLogs,
    getLatestWorkflowAnalysisForRepo,
} from 'database';
import { parseGitHubRepo } from '@/lib/repo';
import { getDeploymentQueue } from '@/lib/queue';

export const runtime = 'nodejs';

function extractFromLogs(logs: Array<{ message: string }>) {
    const diffLog = logs.find((log) => log.message.startsWith('Diff preview:\n'));
    const aiDiffLog = logs.find((log) => log.message.startsWith('AI diff preview:\n'));
    const fixLog = logs.find((log) => log.message.startsWith('Applying '));
    const aiSummaryLog = logs.find((log) => log.message.startsWith('AI fix summary: '));
    const aiFilesLog = logs.find((log) => log.message.startsWith('AI changed files: '));
    return {
        diffPreview: diffLog ? diffLog.message.replace(/^Diff preview:\n/, '') : '',
        aiDiffPreview: aiDiffLog ? aiDiffLog.message.replace(/^AI diff preview:\n/, '') : '',
        fixApplied: fixLog?.message ?? '',
        aiFixSummary: aiSummaryLog ? aiSummaryLog.message.replace(/^AI fix summary:\s*/, '') : '',
        aiChangedFiles: aiFilesLog ? aiFilesLog.message.replace(/^AI changed files:\s*/, '') : '',
    };
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const deployment = await getDeploymentById(id);
        if (!deployment) {
            return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        }

        const logs = await getDeploymentLogs(id);
        const repo = parseGitHubRepo(deployment.original_repo);
        const analysis = repo
            ? await getLatestWorkflowAnalysisForRepo(repo.owner, repo.name)
            : null;
        const extracted = extractFromLogs(logs);

        return NextResponse.json({
            deployment,
            logs,
            analysis,
            diffPreview: extracted.diffPreview,
            fixApplied: extracted.fixApplied,
            aiDiffPreview: extracted.aiDiffPreview,
            aiFixSummary: extracted.aiFixSummary,
            aiChangedFiles: extracted.aiChangedFiles,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown deployment detail error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const deployment = await getDeploymentById(id);
        if (!deployment) {
            return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        }

        // Best-effort cleanup of queued jobs for this deployment.
        try {
            const queue = getDeploymentQueue();
            const jobs = await queue.getJobs(
                ['waiting', 'delayed', 'paused', 'prioritized', 'completed', 'failed'],
                0,
                1000
            );
            const matches = jobs.filter((job) => job.data?.deploymentId === id);
            for (const job of matches) {
                await job.remove().catch(() => undefined);
            }
        } catch {
            // Ignore queue cleanup failures and continue with deletion.
        }

        const deleted = await deleteDeploymentById(id);
        if (!deleted) {
            return NextResponse.json({ error: 'Failed to delete deployment' }, { status: 500 });
        }

        return NextResponse.json({ ok: true, deletedId: id });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown deployment delete error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
