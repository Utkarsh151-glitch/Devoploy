import { NextResponse } from 'next/server';
import { retrieveDocumentationContext } from '@/lib/rag/pipeline';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const query = String(body?.query || '').trim();
        if (!query) {
            return NextResponse.json({ error: 'query is required' }, { status: 400 });
        }
        const matches = await retrieveDocumentationContext(query, { matchCount: 10 });
        return NextResponse.json({ matches });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown docs search error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
