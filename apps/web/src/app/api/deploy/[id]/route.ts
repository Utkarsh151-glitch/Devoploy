import { NextResponse } from 'next/server';
import { getDeploymentById, getDeploymentLogs } from 'database';

export const runtime = 'nodejs';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await context.params;
        if (!id) {
            return NextResponse.json({ error: 'Missing deployment id' }, { status: 400 });
        }

        const deployment = await getDeploymentById(id);
        if (!deployment) {
            return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        }

        const logs = await getDeploymentLogs(id);
        return NextResponse.json({
            deployment,
            logs,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
