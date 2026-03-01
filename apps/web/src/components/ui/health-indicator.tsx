import { CheckCircle2, AlertCircle } from 'lucide-react';

export function HealthIndicator({
    label,
    ok,
    detail,
}: {
    label: string;
    ok: boolean;
    detail?: string;
}) {
    return (
        <div className="rounded-xl border border-white/10 bg-[#0d1324]/80 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
                {ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                ) : (
                    <AlertCircle className="h-4 w-4 text-rose-300" />
                )}
                <span>{label}</span>
            </div>
            {detail ? <p className="mt-1 text-xs text-white/60">{detail}</p> : null}
        </div>
    );
}
