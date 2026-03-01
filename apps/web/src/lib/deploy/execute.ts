import { appendDeploymentLog, updateDeploymentStatus } from 'database';
import { getDeploymentProvider, waitForDeployment } from './providers';

function extractRepoSlug(repoUrl: string): string {
    const cleaned = repoUrl.replace(/\.git$/, '');
    const httpsMatch = cleaned.match(/github\.com[:/](.+\/.+)$/i);
    if (httpsMatch) return httpsMatch[1];
    throw new Error(`Unsupported GitHub repository URL: ${repoUrl}`);
}

export async function executeProviderDeployment(input: {
    deploymentId: string;
    targetCloud: string;
    repoUrl: string;
    sourceBranch: string;
    commitSha?: string;
}) {
    if (input.targetCloud !== 'Vercel') {
        throw new Error(`Cloud provider ${input.targetCloud} is not implemented for manual deploy.`);
    }

    await updateDeploymentStatus(input.deploymentId, 'deploying');
    await appendDeploymentLog(input.deploymentId, 'Manual deployment triggered from dashboard');

    const provider = getDeploymentProvider('vercel');
    const repoSlug = extractRepoSlug(input.repoUrl);
    const triggered = await provider.trigger({
        gitRepository: repoSlug,
        gitBranch: input.sourceBranch || 'main',
        commitSha: input.commitSha,
    });

    await appendDeploymentLog(
        input.deploymentId,
        `Vercel deployment triggered: ${triggered.providerDeploymentId} ${triggered.providerUrl ?? ''}`.trim()
    );

    const polled = await waitForDeployment(provider, triggered.providerDeploymentId);
    if (polled.state === 'ready') {
        await updateDeploymentStatus(input.deploymentId, 'deployed', {
            live_deployment_url: polled.providerUrl ?? triggered.providerUrl ?? null,
            error_message: null,
        });
        await appendDeploymentLog(input.deploymentId, 'Vercel deployment completed successfully', 'SUCCESS');
    } else {
        await updateDeploymentStatus(input.deploymentId, 'deployment_failed', {
            error_message: `Vercel deployment ended in ${polled.state}`,
        });
        await appendDeploymentLog(input.deploymentId, `Vercel deployment failed: ${polled.state}`, 'ERROR');
    }

    return {
        providerDeploymentId: triggered.providerDeploymentId,
        deploymentState: polled.state,
        deploymentUrl: polled.providerUrl ?? triggered.providerUrl,
    };
}
