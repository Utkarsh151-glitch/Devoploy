export function DiffViewer({ diff }: { diff: string }) {
    if (!diff) {
        return (
            <section className="rounded-2xl border border-white/10 bg-[#0d1324]/80 p-4 text-sm text-white/60">
                No diff preview captured.
            </section>
        );
    }

    return (
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1324]/80">
            <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-white">Diff Preview</div>
            <pre className="max-h-96 overflow-auto bg-[#090f1f] p-4 font-mono text-xs text-white/80">
                {diff.split('\n').map((line, idx) => {
                    let className = 'text-white/75';
                    if (line.startsWith('+')) className = 'bg-emerald-500/8 text-emerald-200';
                    if (line.startsWith('-')) className = 'bg-rose-500/8 text-rose-200';
                    if (line.startsWith('@@')) className = 'text-amber-200';
                    if (line.startsWith('---') || line.startsWith('+++')) className = 'text-blue-200';
                    return (
                        <div key={`${idx}-${line.slice(0, 8)}`} className={`rounded px-2 py-0.5 ${className}`}>
                            <span className="mr-2 inline-block w-8 text-right text-white/35">{idx + 1}</span>
                            {line}
                        </div>
                    );
                })}
            </pre>
        </section>
    );
}
