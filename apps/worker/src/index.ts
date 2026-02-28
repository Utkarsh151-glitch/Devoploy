import 'dotenv/config';

import { cloneRepository } from './cloner/cloneRepo';
import { analyzeRepository, applyFixes, revertRollbackPatch } from './engine/analyzeAndFix';
import { pushToBranch } from './bridge/githubPush';
import { createDeploymentWorker } from './queue';
import {
    appendDeploymentLog,
    getDeploymentById,
    updateDeploymentStatus,
} from 'database';

async function processDeployment(deploymentId: string): Promise<void> {
    let repoPath: string | null = null;
    let rollbackPatchPath: string | null = null;
    try {
        const deployment = await getDeploymentById(deploymentId);
        if (!deployment) {
            throw new Error(`Deployment ${deploymentId} not found`);
        }
        if (deployment.status === 'completed') {
            console.log(`[Worker] Skipping already completed deployment ${deploymentId}`);
            return;
        }

        console.log(`\n=== Processing Deployment ${deploymentId} ===`);
        await updateDeploymentStatus(deploymentId, 'cloning');
        await appendDeploymentLog(deploymentId, 'Cloning repository');
        repoPath = await cloneRepository(deployment.original_repo, process.env.GITHUB_TOKEN, {
            onAttemptLog: async (attempt) => {
                await appendDeploymentLog(deploymentId, JSON.stringify(attempt), attempt.status === 'failed' ? 'WARN' : 'INFO');
            },
        });

        await updateDeploymentStatus(deploymentId, 'analyzing');
        await appendDeploymentLog(deploymentId, 'Analyzing repository');
        const analysis = await analyzeRepository(repoPath);
        await appendDeploymentLog(
            deploymentId,
            `Detected stack=${analysis.stack}, projectRoot=${analysis.projectRoot}, entrypoint=${analysis.entrypoint ?? 'n/a'}`
        );
        if (analysis.issues.length > 0) {
            await appendDeploymentLog(
                deploymentId,
                `Detected issues: ${analysis.issues.map((issue) => issue.type).join(', ')}`
            );
        }

        await updateDeploymentStatus(deploymentId, 'fixing');
        await appendDeploymentLog(deploymentId, `Applying ${deployment.target_cloud} fixes for ${analysis.stack}`);
        const fixResult = await applyFixes(repoPath, analysis, deployment.target_cloud);
        rollbackPatchPath = fixResult.rollbackPatchPath;
        await appendDeploymentLog(deploymentId, `Changed files: ${fixResult.changedFiles.join(', ') || 'none'}`);
        if (fixResult.diffPreview && fixResult.diffPreview !== 'No changes required.') {
            await appendDeploymentLog(deploymentId, `Diff preview:\n${fixResult.diffPreview.slice(0, 8000)}`);
        }
        if (fixResult.rollbackPatchPath) {
            await appendDeploymentLog(deploymentId, `Rollback patch: ${fixResult.rollbackPatchPath}`);
        }

        await updateDeploymentStatus(deploymentId, 'pushing');
        await appendDeploymentLog(deploymentId, 'Committing and pushing branch');
        const branch = `devoploy/${deploymentId}`;
        await pushToBranch({
            repoPath,
            targetRepoUrl: deployment.original_repo,
            branch,
            githubToken: process.env.GITHUB_TOKEN,
        });

        await updateDeploymentStatus(deploymentId, 'completed', {
            fixed_branch: branch,
            fixed_repo_url: deployment.original_repo.replace(/\.git$/, '') + `/tree/${branch}`,
            error_message: null,
        });
        await appendDeploymentLog(deploymentId, 'Deployment processing completed', 'SUCCESS');
        console.log(`=== Finished Deployment ${deploymentId} ===\n`);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown worker error';
        if (repoPath && rollbackPatchPath) {
            await revertRollbackPatch(repoPath, rollbackPatchPath).catch(() => undefined);
            await appendDeploymentLog(deploymentId, 'Rollback patch applied after failure', 'WARN').catch(() => undefined);
        }
        await updateDeploymentStatus(deploymentId, 'failed', { error_message: message }).catch(() => undefined);
        await appendDeploymentLog(deploymentId, message, 'ERROR').catch(() => undefined);
        console.error(`=== Failed Deployment ${deploymentId} ===`, error);
        throw error instanceof Error ? error : new Error(message);
    }
}

const worker = createDeploymentWorker(async (job) => {
    try {
        await processDeployment(job.data.deploymentId);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown job handler error';
        console.error(`[Worker] Job handler caught error for deployment ${job.data.deploymentId}: ${message}`);
        throw error instanceof Error ? error : new Error(message);
    }
});

worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
});

console.log('[Worker] Listening for deployment jobs...');
