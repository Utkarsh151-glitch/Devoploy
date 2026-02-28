import { NextResponse } from 'next/server';
import { getDashboardSummary, listRecentActivity } from 'database';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const [summary, recentActivity] = await Promise.all([
            getDashboardSummary(),
            listRecentActivity(25),
        ]);
        return NextResponse.json({ summary, recentActivity });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown dashboard error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
