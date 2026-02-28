import { NextResponse } from 'next/server';
import { listDocumentationSources } from 'database';

export const runtime = 'nodejs';

export async function GET() {
    try {
        const sources = await listDocumentationSources(200);
        const embeddingCount = sources.reduce((acc, source) => acc + source.chunk_count, 0);
        return NextResponse.json({ sources, embeddingCount });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown documentation sources error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
