import type { DeploymentStatus } from 'database';

const colorByStatus: Record<DeploymentStatus, string> = {
    queued: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    cloning: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    analyzing: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    fixing: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    pushing: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    completed: 'bg-green-500/15 text-green-300 border-green-500/30',
    deploying: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
    deployed: 'bg-green-500/15 text-green-300 border-green-500/30',
    deployment_failed: 'bg-red-500/15 text-red-300 border-red-500/30',
    failed: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
    return (
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${colorByStatus[status]}`}>
            {status}
        </span>
    );
}
