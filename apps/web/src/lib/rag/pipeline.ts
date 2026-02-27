import { createHash } from 'crypto';
import OpenAI from 'openai';
import {
    matchDocumentationChunks,
    replaceDocumentationChunks,
    upsertDocumentationSource,
} from 'database';

const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-small';
const CHAT_MODEL = process.env.RAG_CHAT_MODEL || 'gpt-4.1-mini';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required for documentation RAG.');
    }
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey });
    }
    return openaiClient;
}

function normalizeText(input: string): string {
    return input.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}

function chunkText(text: string, maxChars = 1200, overlap = 200): string[] {
    const normalized = normalizeText(text);
    if (!normalized) return [];

    const paragraphs = normalized.split(/\n{2,}/g).filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const paragraph of paragraphs) {
        if ((current + '\n\n' + paragraph).length <= maxChars) {
            current = current ? `${current}\n\n${paragraph}` : paragraph;
            continue;
        }

        if (current) chunks.push(current);
        if (paragraph.length <= maxChars) {
            current = paragraph;
            continue;
        }

        let start = 0;
        while (start < paragraph.length) {
            const end = Math.min(paragraph.length, start + maxChars);
            const segment = paragraph.slice(start, end);
            chunks.push(segment);
            start = Math.max(end - overlap, end);
        }
        current = '';
    }

    if (current) chunks.push(current);
    return chunks;
}

async function embedTexts(chunks: string[]): Promise<number[][]> {
    if (chunks.length === 0) return [];
    const client = getOpenAI();
    const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: chunks,
    });
    return response.data.map((item) => item.embedding);
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export async function ingestDocumentation(input: {
    source: string;
    title: string;
    text: string;
    metadata?: Record<string, unknown>;
}): Promise<{ sourceId: string; chunkCount: number }> {
    const normalized = normalizeText(input.text);
    if (!normalized) {
        throw new Error('Document content is empty.');
    }

    const contentHash = createHash('sha256').update(normalized).digest('hex');
    const source = await upsertDocumentationSource({
        source: input.source,
        title: input.title,
        contentHash,
        metadata: input.metadata,
    });

    const chunks = chunkText(normalized);
    const embeddings = await embedTexts(chunks);

    await replaceDocumentationChunks(
        source.id,
        chunks.map((content, index) => ({
            chunkIndex: index,
            content,
            tokenCount: estimateTokens(content),
            embedding: embeddings[index],
            metadata: input.metadata,
        }))
    );

    return { sourceId: source.id, chunkCount: chunks.length };
}

export async function retrieveDocumentationContext(
    errorText: string,
    options: { matchCount?: number; metadataFilter?: Record<string, unknown> } = {}
) {
    const [embedding] = await embedTexts([normalizeText(errorText)]);
    const matches = await matchDocumentationChunks(embedding, options.matchCount ?? 6, options.metadataFilter ?? {});
    return matches;
}

export async function generateContextualFixSuggestion(input: {
    ciError: string;
    category: string;
    chunks: Array<{ content: string; similarity: number }>;
}): Promise<string> {
    if (input.chunks.length === 0) {
        return 'No relevant documentation chunks found for this CI failure.';
    }

    const client = getOpenAI();
    const context = input.chunks
        .slice(0, 5)
        .map((chunk, i) => `Context ${i + 1} (similarity ${chunk.similarity.toFixed(3)}):\n${chunk.content}`)
        .join('\n\n');

    const completion = await client.responses.create({
        model: CHAT_MODEL,
        input: [
            {
                role: 'system',
                content:
                    'You are a senior DevOps engineer. Use only provided documentation context. Return concise actionable fix steps.',
            },
            {
                role: 'user',
                content: [
                    `CI failure category: ${input.category}`,
                    `CI extracted error:\n${input.ciError}`,
                    `Relevant documentation:\n${context}`,
                    'Produce: root cause, exact fix steps, and verification checklist.',
                ].join('\n\n'),
            },
        ],
        temperature: 0.2,
    });

    return completion.output_text?.trim() || 'Unable to generate contextual fix suggestion.';
}
