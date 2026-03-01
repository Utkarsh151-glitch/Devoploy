export default function Loading() {
    return (
        <div className="space-y-4">
            <div className="h-8 w-56 animate-pulse rounded-lg bg-white/10" />
            <div className="grid gap-4 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="h-28 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
                ))}
            </div>
            <div className="h-72 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
        </div>
    );
}
