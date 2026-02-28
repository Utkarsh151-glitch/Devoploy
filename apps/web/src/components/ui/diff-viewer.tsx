export function DiffViewer({ diff }: { diff: string }) {
    if (!diff) {
        return (
            <section className="rounded-xl border border-white/10 bg-[#0f1218] p-4 text-sm text-white/60">
                No diff preview captured.
            </section>
        );
    }

    return (
        <section className="rounded-xl border border-white/10 bg-[#0f1218]">
            <div className="border-b border-white/10 px-4 py-3 text-sm font-medium text-white">Diff Preview</div>
            <pre className="max-h-96 overflow-auto p-4 font-mono text-xs text-white/80">
                {diff.split('\n').map((line, idx) => {
                    let className = 'text-white/75';
                    if (line.startsWith('+')) className = 'text-green-300';
                    if (line.startsWith('-')) className = 'text-red-300';
                    if (line.startsWith('@@')) className = 'text-yellow-300';
                    return (
                        <div key={`${idx}-${line.slice(0, 8)}`} className={className}>
                            {line}
                        </div>
                    );
                })}
            </pre>
        </section>
    );
}
