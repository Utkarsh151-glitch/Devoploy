import { CheckCircle2, Circle } from 'lucide-react';

export function Timeline({
    stages,
    currentStage,
}: {
    stages: string[];
    currentStage: string;
}) {
    const currentIndex = Math.max(stages.indexOf(currentStage), 0);

    return (
        <ol className="space-y-4">
            {stages.map((stage, index) => {
                const done = index <= currentIndex;
                const last = index === stages.length - 1;
                return (
                    <li key={stage} className="flex gap-3">
                        <div className="flex flex-col items-center">
                            {done ? (
                                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                            ) : (
                                <Circle className="h-5 w-5 text-white/40" />
                            )}
                            {!last ? <span className={`mt-1 h-7 w-px ${done ? 'bg-emerald-300/50' : 'bg-white/15'}`} /> : null}
                        </div>
                        <div className="-mt-0.5">
                            <p className={`text-sm font-medium ${done ? 'text-white' : 'text-white/55'}`}>{stage}</p>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
