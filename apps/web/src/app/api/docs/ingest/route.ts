import { NextResponse } from 'next/server';
import { ingestDocumentation } from '@/lib/rag/pipeline';

export const runtime = 'nodejs';

function isAllowedDocument(filename: string): boolean {
    return /\.(md|markdown|txt)$/i.test(filename);
}

export async function POST(req: Request) {
    try {
        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            const form = await req.formData();
            const file = form.get('file');
            const source = String(form.get('source') || 'uploaded');
            const title = String(form.get('title') || '');

            if (!(file instanceof File)) {
                return NextResponse.json({ error: 'file is required' }, { status: 400 });
            }
            if (!isAllowedDocument(file.name)) {
                return NextResponse.json({ error: 'Only .md, .markdown, and .txt files are supported' }, { status: 400 });
            }

            const text = await file.text();
            const result = await ingestDocumentation({
                source,
                title: title || file.name,
                text,
            });

            return NextResponse.json({ ok: true, ...result });
        }

        const body = await req.json();
        const { source, title, text, metadata } = body ?? {};
        if (!source || !title || !text) {
            return NextResponse.json({ error: 'source, title and text are required' }, { status: 400 });
        }

        const result = await ingestDocumentation({
            source: String(source),
            title: String(title),
            text: String(text),
            metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
        });

        return NextResponse.json({ ok: true, ...result });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown ingestion error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
