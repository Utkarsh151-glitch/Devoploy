'use client';

import { FormEvent, useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/ui';

type DocSource = {
    id: string;
    source: string;
    title: string;
    updated_at: string;
    chunk_count: number;
};

export default function DocumentationPage() {
    const [sources, setSources] = useState<DocSource[]>([]);
    const [embeddingCount, setEmbeddingCount] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<any[]>([]);
    const [error, setError] = useState('');

    const loadSources = async () => {
        const response = await fetch('/api/docs/sources', { cache: 'no-store' });
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error || 'Failed to fetch documentation sources');
        setSources(json.sources ?? []);
        setEmbeddingCount(json.embeddingCount ?? 0);
    };

    useEffect(() => {
        loadSources().catch((err) => setError(err instanceof Error ? err.message : 'Unknown docs error'));
    }, []);

    const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setUploading(true);
        setError('');
        try {
            const formData = new FormData(event.currentTarget);
            const response = await fetch('/api/docs/ingest', { method: 'POST', body: formData });
            const json = await response.json();
            if (!response.ok) throw new Error(json?.error || 'Upload failed');
            await loadSources();
            event.currentTarget.reset();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleSearch = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        try {
            const response = await fetch('/api/docs/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query }),
            });
            const json = await response.json();
            if (!response.ok) throw new Error(json?.error || 'Search failed');
            setMatches(json.matches ?? []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Search failed');
        }
    };

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Documentation</h1>

            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</div>}

            <section className="rounded-xl border border-white/10 bg-[#11141a] p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">Upload Documentation</h2>
                <form className="grid gap-3 md:grid-cols-4" onSubmit={handleUpload}>
                    <input name="source" placeholder="source (repo/docs)" className="rounded-lg border border-white/10 bg-[#0f1218] px-3 py-2 text-sm" />
                    <input name="title" placeholder="title" className="rounded-lg border border-white/10 bg-[#0f1218] px-3 py-2 text-sm" />
                    <input name="file" type="file" accept=".md,.markdown,.txt" required className="rounded-lg border border-white/10 bg-[#0f1218] px-3 py-2 text-sm" />
                    <button disabled={uploading} className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200">
                        {uploading ? 'Uploading...' : 'Upload'}
                    </button>
                </form>
            </section>

            <section className="rounded-xl border border-white/10 bg-[#11141a] p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">Search Chunks</h2>
                <form className="flex gap-2" onSubmit={handleSearch}>
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search text"
                        className="flex-1 rounded-lg border border-white/10 bg-[#0f1218] px-3 py-2 text-sm"
                    />
                    <button className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200">Search</button>
                </form>
                <div className="mt-3 space-y-2">
                    {matches.map((match) => (
                        <div key={match.id} className="rounded-lg border border-white/10 bg-[#0f1218] p-3 text-xs text-white/75">
                            <div className="mb-1 text-white/50">Similarity: {(Number(match.similarity) * 100).toFixed(2)}%</div>
                            <div className="whitespace-pre-wrap">{match.content}</div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-white/10 bg-[#11141a]">
                <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">Sources ({sources.length}) | Embeddings: {embeddingCount}</div>
                <table className="min-w-full text-sm">
                    <thead className="bg-white/5 text-left text-white/70">
                        <tr>
                            <th className="px-4 py-3">Title</th>
                            <th className="px-4 py-3">Source</th>
                            <th className="px-4 py-3">Chunks</th>
                            <th className="px-4 py-3">Updated</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sources.map((source) => (
                            <tr key={source.id} className="border-t border-white/5 text-white/80">
                                <td className="px-4 py-3">{source.title}</td>
                                <td className="px-4 py-3">{source.source}</td>
                                <td className="px-4 py-3">{source.chunk_count}</td>
                                <td className="px-4 py-3">{formatDateTime(source.updated_at)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
