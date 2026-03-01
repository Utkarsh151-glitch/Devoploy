import { NextResponse } from 'next/server';
import { getDeploymentById } from 'database';
import { executeProviderDeployment } from '@/lib/deploy/execute';

export const runtime = 'nodejs';

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        const deployment = await getDeploymentById(id);
        if (!deployment) {
            return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        }

        if (!['completed', 'deployment_failed', 'deployed'].includes(deployment.status)) {
            return NextResponse.json(
                { error: `Deploy is allowed after fixing completes. Current status: ${deployment.status}` },
                { status: 400 }
            );
        }

        const result = await executeProviderDeployment({
            deploymentId: deployment.id,
            targetCloud: deployment.target_cloud,
            repoUrl: deployment.original_repo,
            sourceBranch: deployment.fixed_branch ?? deployment.source_branch ?? 'main',
        });

        return NextResponse.json({ ok: true, deploymentId: deployment.id, ...result });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown manual deploy error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
