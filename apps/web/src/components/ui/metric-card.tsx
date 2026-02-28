export function MetricCard({
    label,
    value,
    tone = 'neutral',
}: {
    label: string;
    value: string | number;
    tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
    const toneClasses = {
        neutral: 'border-white/10',
        success: 'border-green-500/25',
        warning: 'border-yellow-500/25',
        danger: 'border-red-500/25',
    }[tone];

    return (
        <div className={`rounded-xl border bg-[#11141a] p-4 ${toneClasses}`}>
            <p className="text-xs uppercase tracking-wide text-white/60">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
        </div>
    );
}
