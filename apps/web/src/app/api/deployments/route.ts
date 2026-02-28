import { NextResponse } from 'next/server';
import { listDeployments } from 'database';
import type { DeploymentStatus } from 'database';

export const runtime = 'nodejs';

const VALID_STATUS: DeploymentStatus[] = [
    'queued',
    'cloning',
    'analyzing',
    'fixing',
    'pushing',
    'completed',
    'deploying',
    'deployed',
    'deployment_failed',
    'failed',
];

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const statusParam = searchParams.get('status')?.trim() as DeploymentStatus | undefined;
        const repo = searchParams.get('repo')?.trim() || undefined;
        const page = Number(searchParams.get('page') || '1');
        const pageSize = Number(searchParams.get('pageSize') || '20');

        const status = statusParam && VALID_STATUS.includes(statusParam) ? statusParam : undefined;
        const result = await listDeployments({ status, repo, page, pageSize });
        return NextResponse.json(result);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown deployments list error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
