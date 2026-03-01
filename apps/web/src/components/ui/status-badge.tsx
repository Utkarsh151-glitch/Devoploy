import type { DeploymentStatus } from 'database';

const colorByStatus: Record<DeploymentStatus, string> = {
    queued: 'border-blue-400/30 bg-blue-500/15 text-blue-200 status-glow-info',
    cloning: 'border-blue-400/30 bg-blue-500/15 text-blue-200 status-glow-info',
    analyzing: 'border-blue-400/30 bg-blue-500/15 text-blue-200 status-glow-info',
    fixing: 'border-amber-400/30 bg-amber-500/15 text-amber-200 status-glow-warning',
    pushing: 'border-amber-400/30 bg-amber-500/15 text-amber-200 status-glow-warning',
    completed: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200 status-glow-success',
    deploying: 'border-blue-400/30 bg-blue-500/15 text-blue-200 status-glow-info',
    deployed: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200 status-glow-success',
    deployment_failed: 'border-rose-400/30 bg-rose-500/15 text-rose-200 status-glow-error',
    failed: 'border-rose-400/30 bg-rose-500/15 text-rose-200 status-glow-error',
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${colorByStatus[status]}`}>
            {status}
        </span>
    );
}
