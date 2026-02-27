import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createOrGetDeployment, toDeploymentJobPayload, updateDeploymentStatus } from 'database';
import type { CloudProvider } from 'database';
import { getDeploymentQueue } from '@/lib/queue';

export const runtime = 'nodejs';

const SUPPORTED_CLOUDS: CloudProvider[] = ['Vercel', 'AWS', 'Heroku', 'GCP'];

function isValidRepoUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;

    try {
        const url = new URL(value);
        return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
    } catch {
        return false;
    }
}

function isValidCloud(value: unknown): value is CloudProvider {
    return typeof value === 'string' && SUPPORTED_CLOUDS.includes(value as CloudProvider);
}

function getIdempotencyKey(req: Request, repoUrl: string, targetCloud: CloudProvider): string {
    const provided = req.headers.get('x-idempotency-key')?.trim();
    if (provided) return provided;

    return createHash('sha256')
        .update(`${repoUrl}:${targetCloud}`)
        .digest('hex');
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { repoUrl, targetCloud } = body;

        if (!isValidRepoUrl(repoUrl)) {
            return NextResponse.json({ error: 'Invalid repoUrl' }, { status: 400 });
        }
        if (!isValidCloud(targetCloud)) {
            return NextResponse.json({ error: 'Invalid targetCloud' }, { status: 400 });
        }

        const idempotencyKey = getIdempotencyKey(req, repoUrl, targetCloud);
        const deployment = await createOrGetDeployment({
            repoUrl,
            targetCloud,
            idempotencyKey,
        });

        if (deployment.status === 'queued') {
            try {
                const queue = getDeploymentQueue();
                await queue.add('deployment.process', toDeploymentJobPayload(deployment.id), {
                    jobId: deployment.id,
                    attempts: 1,
                    removeOnComplete: 100,
                    removeOnFail: 200,
                });
            } catch (enqueueError) {
                const message = enqueueError instanceof Error ? enqueueError.message : 'Queue enqueue failed';
                await updateDeploymentStatus(deployment.id, 'failed', { error_message: message }).catch(() => undefined);
                throw enqueueError;
            }
        }

        return NextResponse.json({
            success: true,
            deploymentId: deployment.id,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unexpected error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
