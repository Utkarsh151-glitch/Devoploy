import { NextResponse } from 'next/server';
import { listRepositorySummaries } from 'database';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const repos = await listRepositorySummaries(200);
        return NextResponse.json({
            repos,
            githubAppInstallUrl: process.env.GITHUB_APP_INSTALL_URL || 'https://github.com/settings/apps',
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown repos error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
