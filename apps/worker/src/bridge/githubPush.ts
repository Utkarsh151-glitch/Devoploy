import { runGitCommand } from '../git/runGitCommand';

interface PushToBranchInput {
    repoPath: string;
    targetRepoUrl: string;
    branch: string;
    githubToken?: string;
}

function isPlaceholderToken(token?: string): boolean {
    if (!token) return true;
    const trimmed = token.trim();
    return (
        trimmed.length < 20 ||
        trimmed === 'YOUR_GITHUB_TOKEN' ||
        trimmed.includes('YOUR_')
    );
}

function withGithubToken(repoUrl: string, githubToken?: string): string {
    if (!githubToken) return repoUrl;
    try {
        const url = new URL(repoUrl);
        if (url.protocol !== 'https:' || !url.hostname.endsWith('github.com')) {
            return repoUrl;
        }
        url.username = 'x-access-token';
        url.password = githubToken;
        return url.toString();
    } catch {
        return repoUrl;
    }
}

export async function pushToBranch(input: PushToBranchInput) {
    console.log(`[Bridge] Committing mapped changes and pushing to ${input.targetRepoUrl}#${input.branch}`);
    if (/github\.com/i.test(input.targetRepoUrl) && isPlaceholderToken(input.githubToken)) {
        throw new Error(
            'GITHUB_TOKEN is missing or placeholder. Set a real GitHub token with repository write access in .env.'
        );
    }
    const remoteUrl = withGithubToken(input.targetRepoUrl, input.githubToken);

    try {
        await runGitCommand({
            args: ['config', 'user.name', 'Devoploy Bot'],
            cwd: input.repoPath,
        });
        await runGitCommand({
            args: ['config', 'user.email', 'bot@devoploy.com'],
            cwd: input.repoPath,
        });
        await runGitCommand({
            args: ['checkout', '-B', input.branch],
            cwd: input.repoPath,
        });
        await runGitCommand({
            args: ['add', '-A'],
            cwd: input.repoPath,
        });

        const status = await runGitCommand({
            args: ['status', '--porcelain'],
            cwd: input.repoPath,
        });
        if (status.stdout.trim()) {
            await runGitCommand({
                args: ['commit', '-m', 'chore: automated deployment fixes'],
                cwd: input.repoPath,
            });
        } else {
            console.log('[Bridge] No file changes detected after fixing step; skipping commit.');
        }

        await runGitCommand({
            args: ['push', remoteUrl, `HEAD:refs/heads/${input.branch}`, '--force'],
            cwd: input.repoPath,
            timeoutMs: 60_000,
        });

        console.log(`[Bridge] Successfully pushed to Devoploy Registry.`);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown git push error';
        console.error('[Bridge] Error pushing repository:', message);
        throw error;
    }
}
