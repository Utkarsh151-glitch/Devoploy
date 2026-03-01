import { classifyCiLog } from 'ci-parser';
import { NextResponse } from 'next/server';
import {
    appendDeploymentLog,
    getDeploymentById,
    getDeploymentByFixedBranch,
    upsertWorkflowFailureAnalysis,
    updateDeploymentStatus,
} from 'database';
import {
    applyFixPatch,
    commentAnalysisSummary,
    fetchWorkflowRunLogs,
    openPullRequest,
    getWebhookVerifier,
    type WorkflowRunContext,
} from '@/lib/githubApp';
import { executeProviderDeployment } from '@/lib/deploy/execute';
import { generateContextualFixSuggestion, retrieveDocumentationContext } from '@/lib/rag/pipeline';

export const runtime = 'nodejs';

interface WorkflowRunPayload {
    action: string;
    installation?: { id: number };
    repository: { name: string; owner: { login: string } };
    workflow_run: {
        id: number;
        name?: string;
        conclusion: string | null;
        head_branch: string;
        head_sha: string;
        html_url?: string;
    };
}

interface PullRequestPayload {
    action: string;
    installation?: { id: number };
    repository: { name: string; owner: { login: string } };
    pull_request: {
        merged: boolean;
        merge_commit_sha?: string;
        head: { ref: string };
        base: { ref: string };
    };
}

function getHeader(req: Request, key: string): string {
    const value = req.headers.get(key);
    if (!value) throw new Error(`Missing header ${key}`);
    return value;
}

export async function POST(req: Request) {
    try {
        const body = await req.text();
        const signature = getHeader(req, 'x-hub-signature-256');
        const event = getHeader(req, 'x-github-event');
        const delivery = getHeader(req, 'x-github-delivery');

        const verifier = getWebhookVerifier();
        const isValid = await verifier.verify(body, signature);
        if (!isValid) {
            return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
        }

        if (event === 'workflow_run') {
            const payload = JSON.parse(body) as WorkflowRunPayload;
            return handleWorkflowRun(payload, delivery);
        }
        if (event === 'pull_request') {
            const payload = JSON.parse(body) as PullRequestPayload;
            return handlePullRequest(payload, delivery);
        }
        return NextResponse.json({ ok: true, ignored: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown webhook error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

async function handleWorkflowRun(payload: WorkflowRunPayload, delivery: string) {
    if (payload.action !== 'completed' || payload.workflow_run.conclusion !== 'failure') {
        return NextResponse.json({ ok: true, ignored: true });
    }

    if (!payload.installation?.id) {
        return NextResponse.json({ error: 'Missing installation id' }, { status: 400 });
    }

    const context: WorkflowRunContext = {
        installationId: payload.installation.id,
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        runId: payload.workflow_run.id,
        workflowName: payload.workflow_run.name,
        headBranch: payload.workflow_run.head_branch,
        headSha: payload.workflow_run.head_sha,
        htmlUrl: payload.workflow_run.html_url,
    };

    let stage = 'fetch_logs';
    try {
        const rawLogs = await fetchWorkflowRunLogs(context);

        stage = 'classify_logs';
        const classified = classifyCiLog(rawLogs);

        stage = 'retrieve_rag_context';
        const contextChunks = await retrieveDocumentationContext(classified.extractedError, {
            matchCount: 6,
            metadataFilter: { repository: `${context.owner}/${context.repo}` },
        }).catch(() => []);
        const fallbackChunks = contextChunks.length > 0
            ? contextChunks
            : await retrieveDocumentationContext(classified.extractedError, { matchCount: 6 }).catch(() => []);
        const contextualSuggestion = await generateContextualFixSuggestion({
            ciError: classified.extractedError,
            category: classified.category,
            chunks: fallbackChunks.map((chunk) => ({ content: chunk.content, similarity: chunk.similarity })),
        }).catch(() => 'Contextual fix suggestion unavailable (RAG retrieval/generation failed).');

        stage = 'persist_analysis';
        await upsertWorkflowFailureAnalysis({
            installationId: context.installationId,
            repositoryOwner: context.owner,
            repositoryName: context.repo,
            workflowRunId: context.runId,
            workflowName: context.workflowName,
            headBranch: context.headBranch,
            headSha: context.headSha,
            htmlUrl: context.htmlUrl,
            category: classified.category,
            confidence: classified.confidence,
            extractedError: classified.extractedError,
            originalLogSnippet: classified.originalLogSnippet,
            suggestedFixType: classified.suggestedFixType,
            ruleMatched: classified.explainability.ruleMatched,
            whyThisFix: classified.explainability.whyThisFix,
        });

        stage = 'apply_patch';
        const patchResult = await applyFixPatch(context, classified);

        stage = 'open_pull_request';
        const prNumber = await openPullRequest(context, patchResult.branch, classified);

        stage = 'comment_pull_request';
        await commentAnalysisSummary(context, prNumber, classified, contextualSuggestion);

        return NextResponse.json({
            ok: true,
            delivery,
            workflowRunId: context.runId,
            category: classified.category,
            branch: patchResult.branch,
            prNumber,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown workflow_run processing error';
        return NextResponse.json(
            {
                error: message,
                stage,
                workflowRunId: context.runId,
            },
            { status: 500 }
        );
    }
}

async function handlePullRequest(payload: PullRequestPayload, delivery: string) {
    if (payload.action !== 'closed' || !payload.pull_request.merged) {
        return NextResponse.json({ ok: true, ignored: true });
    }

    const headBranch = payload.pull_request.head.ref;
    const deploymentId = extractDeploymentIdFromBranch(headBranch);
    if (!deploymentId) {
        return NextResponse.json({ ok: true, ignored: true, reason: 'not devoploy deployment branch' });
    }

    let deployment = await getDeploymentById(deploymentId);
    if (!deployment) {
        deployment = await getDeploymentByFixedBranch(headBranch);
    }
    if (!deployment) {
        return NextResponse.json({ ok: true, ignored: true, reason: 'deployment not found' });
    }
    if (deployment.target_cloud !== 'Vercel') {
        return NextResponse.json({ ok: true, ignored: true, reason: 'provider not configured' });
    }
    if (deployment.status === 'deployed') {
        return NextResponse.json({ ok: true, ignored: true, reason: 'already deployed' });
    }

    const autoDeployEnabled = String(process.env.AUTO_DEPLOY_ON_PR_MERGE || '').toLowerCase() === 'true';
    if (!autoDeployEnabled) {
        await appendDeploymentLog(
            deployment.id,
            'PR merged; auto deploy is disabled. Trigger deployment from dashboard Deploy button.',
            'INFO'
        );
        return NextResponse.json({
            ok: true,
            delivery,
            deploymentId: deployment.id,
            ignored: true,
            reason: 'auto deploy disabled',
        });
    }

    try {
        const result = await executeProviderDeployment({
            deploymentId: deployment.id,
            targetCloud: deployment.target_cloud,
            repoUrl: deployment.original_repo,
            sourceBranch: payload.pull_request.base.ref,
            commitSha: payload.pull_request.merge_commit_sha,
        });

        return NextResponse.json({
            ok: true,
            delivery,
            deploymentId: deployment.id,
            deploymentState: result.deploymentState,
            deploymentUrl: result.deploymentUrl,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown deployment provider error';
        await updateDeploymentStatus(deployment.id, 'deployment_failed', { error_message: message }).catch(() => undefined);
        await appendDeploymentLog(deployment.id, message, 'ERROR').catch(() => undefined);
        throw error;
    }
}

function extractDeploymentIdFromBranch(branch: string): string | null {
    const match = branch.match(/^devoploy\/([a-f0-9-]{36})$/i);
    return match?.[1] ?? null;
}
