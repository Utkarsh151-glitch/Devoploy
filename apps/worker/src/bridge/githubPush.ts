import { runGitCommand } from '../git/runGitCommand';

interface PushToBranchInput {
    repoPath: string;
    targetRepoUrl: string;
    branch: string;
    githubToken?: string;
}

export interface PushResult {
    pushedRepoUrl: string;
    branch: string;
    usedFork: boolean;
}

interface GitHubRepoRef {
    owner: string;
    repo: string;
}

function isPlaceholderToken(token?: string): boolean {
    if (!token) return true;
    const trimmed = token.trim();
    return trimmed.length < 20 || trimmed === 'YOUR_GITHUB_TOKEN' || trimmed.includes('YOUR_');
}

function parseGitHubRepo(repoUrl: string): GitHubRepoRef | null {
    try {
        const url = new URL(repoUrl);
        if (url.hostname !== 'github.com') return null;
        const [owner, repoRaw] = url.pathname.replace(/^\/+/, '').split('/');
        if (!owner || !repoRaw) return null;
        return { owner, repo: repoRaw.replace(/\.git$/, '') };
    } catch {
        return null;
    }
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

function toTreeUrl(repoUrl: string, branch: string): string {
    return `${repoUrl.replace(/\.git$/, '')}/tree/${branch}`;
}

async function githubRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
    const baseHeaders = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.headers || {}),
    };

    const attempt = async (authHeader: string): Promise<Response> =>
        fetch(url, {
            ...init,
            headers: {
                ...baseHeaders,
                Authorization: authHeader,
            },
        });

    // Primary auth format.
    let response = await attempt(`Bearer ${token}`);

    // Some PAT variants/environments still expect the legacy "token" scheme.
    if (response.status === 401) {
        response = await attempt(`token ${token}`);
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub API ${response.status}: ${text.slice(0, 500)}`);
    }

    return (await response.json()) as T;
}

async function getAuthenticatedUsername(token: string): Promise<string> {
    const me = await githubRequest<{ login: string }>('https://api.github.com/user', token);
    return me.login;
}

async function ensureForkRepo(original: GitHubRepoRef, token: string): Promise<string> {
    const username = await getAuthenticatedUsername(token);
    if (original.owner.toLowerCase() === username.toLowerCase()) {
        throw new Error(
            `Fork fallback is not available because ${original.owner}/${original.repo} is already owned by ${username}. ` +
                'Use a token with write access to this repository (Contents: Read and write for fine-grained PAT).'
        );
    }

    // If fork already exists, use it directly.
    try {
        await githubRequest(`https://api.github.com/repos/${username}/${original.repo}`, token);
        return `https://github.com/${username}/${original.repo}.git`;
    } catch {
        // Continue to fork creation.
    }

    const forkApi = `https://api.github.com/repos/${original.owner}/${original.repo}/forks`;

    try {
        await githubRequest(forkApi, token, { method: 'POST' });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Resource not accessible by personal access token')) {
            throw new Error(
                `Fork creation blocked by token permissions for ${original.owner}/${original.repo}. ` +
                    'Use a token with repository write access (Contents: Read and write), or create the fork manually and retry.'
            );
        }
        throw error;
    }

    // Poll fork availability because GitHub fork creation is async.
    for (let i = 0; i < 10; i += 1) {
        try {
            await githubRequest(`https://api.github.com/repos/${username}/${original.repo}`, token);
            return `https://github.com/${username}/${original.repo}.git`;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    throw new Error('Fork creation requested but fork repository did not become available in time.');
}

function isPermissionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes('permission') || message.includes('403') || message.includes('authentication failed');
}

export async function pushToBranch(input: PushToBranchInput): Promise<PushResult> {
    const pushTimeoutMs = Number(process.env.PUSH_TIMEOUT_MS || '180000');
    const allowForkFallback = (process.env.AUTO_FORK_ON_PUSH_DENIED || 'true').toLowerCase() === 'true';

    console.log(`[Bridge] Committing mapped changes and pushing to ${input.targetRepoUrl}#${input.branch}`);
    if (/github\.com/i.test(input.targetRepoUrl) && isPlaceholderToken(input.githubToken)) {
        throw new Error('GITHUB_TOKEN is missing or placeholder. Set a real GitHub token with repository write access in .env.');
    }

    await runGitCommand({ args: ['config', 'user.name', 'Devoploy Bot'], cwd: input.repoPath });
    await runGitCommand({ args: ['config', 'user.email', 'bot@devoploy.com'], cwd: input.repoPath });
    await runGitCommand({ args: ['checkout', '-B', input.branch], cwd: input.repoPath });
    await runGitCommand({ args: ['add', '-A'], cwd: input.repoPath });

    const status = await runGitCommand({ args: ['status', '--porcelain'], cwd: input.repoPath });
    if (status.stdout.trim()) {
        await runGitCommand({ args: ['commit', '-m', 'chore: automated deployment fixes'], cwd: input.repoPath });
    } else {
        console.log('[Bridge] No file changes detected after fixing step; skipping commit.');
    }

    const originalRemote = withGithubToken(input.targetRepoUrl, input.githubToken);

    try {
        await runGitCommand({
            args: ['push', originalRemote, `HEAD:refs/heads/${input.branch}`, '--force'],
            cwd: input.repoPath,
            timeoutMs: pushTimeoutMs,
        });
        console.log('[Bridge] Successfully pushed to source repository.');
        return {
            pushedRepoUrl: toTreeUrl(input.targetRepoUrl, input.branch),
            branch: input.branch,
            usedFork: false,
        };
    } catch (error: unknown) {
        if (!allowForkFallback || !input.githubToken || !isPermissionError(error)) {
            const message = error instanceof Error ? error.message : 'Unknown git push error';
            console.error('[Bridge] Error pushing repository:', message);
            throw error;
        }

        const repoRef = parseGitHubRepo(input.targetRepoUrl);
        if (!repoRef) {
            throw error;
        }

        console.warn('[Bridge] Push permission denied. Falling back to fork push...');
        const forkRemoteUrl = await ensureForkRepo(repoRef, input.githubToken);
        const forkRemoteWithToken = withGithubToken(forkRemoteUrl, input.githubToken);

        await runGitCommand({
            args: ['push', forkRemoteWithToken, `HEAD:refs/heads/${input.branch}`, '--force'],
            cwd: input.repoPath,
            timeoutMs: pushTimeoutMs,
        });

        console.log(`[Bridge] Pushed successfully to fork ${forkRemoteUrl}`);
        return {
            pushedRepoUrl: toTreeUrl(forkRemoteUrl, input.branch),
            branch: input.branch,
            usedFork: true,
        };
    }
}
