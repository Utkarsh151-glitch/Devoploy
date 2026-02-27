import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'fs';

interface PushToBranchInput {
    repoPath: string;
    targetRepoUrl: string;
    branch: string;
    githubToken?: string;
}

function hasWorkingTreeChanges(matrix: Array<[string, number, number, number]>): boolean {
    return matrix.some(([, head, workdir, stage]) => head !== workdir || workdir !== stage);
}

export async function pushToBranch(input: PushToBranchInput) {
    console.log(`[Bridge] Committing mapped changes and pushing to ${input.targetRepoUrl}#${input.branch}`);

    try {
        await git.setConfig({
            fs,
            dir: input.repoPath,
            path: 'remote.origin.url',
            value: input.targetRepoUrl,
        });

        const localBranches = await git.listBranches({ fs, dir: input.repoPath });
        if (localBranches.includes(input.branch)) {
            await git.checkout({ fs, dir: input.repoPath, ref: input.branch });
        } else {
            await git.branch({ fs, dir: input.repoPath, ref: input.branch, checkout: true });
        }

        await git.add({ fs, dir: input.repoPath, filepath: '.' });

        const matrix = await git.statusMatrix({ fs, dir: input.repoPath });
        if (hasWorkingTreeChanges(matrix)) {
            await git.commit({
                fs,
                dir: input.repoPath,
                author: {
                    name: 'Devoploy Bot',
                    email: 'bot@devoploy.com',
                },
                message: 'chore: automated deployment fixes',
            });
        } else {
            console.log('[Bridge] No file changes detected after fixing step; skipping commit.');
        }

        await git.push({
            fs,
            http,
            dir: input.repoPath,
            remote: 'origin',
            ref: input.branch,
            force: true,
            onAuth: input.githubToken
                ? () => ({ username: 'x-access-token', password: input.githubToken })
                : undefined,
        });

        console.log(`[Bridge] Successfully pushed to Devoploy Registry.`);
    } catch (error) {
        console.error(`[Bridge] Error pushing repository:`, error);
        throw error;
    }
}
