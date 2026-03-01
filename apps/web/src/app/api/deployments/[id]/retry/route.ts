import { NextResponse } from 'next/server';
import {
    appendDeploymentLog,
    getDeploymentById,
    toDeploymentJobPayload,
    updateDeploymentStatus,
} from 'database';
import { getDeploymentQueue } from '@/lib/queue';

export const runtime = 'nodejs';

function buildRetryJobId(deploymentId: string): string {
    return `${deploymentId}:retry:${Date.now()}`;
}

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const deployment = await getDeploymentById(id);
        if (!deployment) {
            return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        }

        if (!['failed', 'deployment_failed', 'queued'].includes(deployment.status)) {
            return NextResponse.json(
                { error: `Retry is allowed for failed or queued deployments. Current status: ${deployment.status}` },
                { status: 400 }
            );
        }

        await updateDeploymentStatus(id, 'queued', { error_message: null });
        await appendDeploymentLog(
            id,
            deployment.status === 'queued'
                ? 'Manual requeue requested from dashboard'
                : 'Manual retry requested from dashboard',
            'INFO'
        );
        const queue = getDeploymentQueue();
        await queue.add('deployment.process', toDeploymentJobPayload(id), {
            jobId: buildRetryJobId(id),
            attempts: 1,
            removeOnComplete: 100,
            removeOnFail: 200,
        });

        return NextResponse.json({ ok: true, deploymentId: id });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown retry error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
