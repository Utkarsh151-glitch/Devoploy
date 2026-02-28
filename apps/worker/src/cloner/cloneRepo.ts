import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { runGitCommand } from '../git/runGitCommand';

const MAX_RETRIES = 3;
const CLONE_TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export interface CloneAttemptLog {
    stage: 'cloning';
    attempt: number;
    duration: number;
    status: 'success' | 'failed';
}

interface CloneOptions {
    onAttemptLog?: (log: CloneAttemptLog) => Promise<void> | void;
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

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupDirectory(dir: string): Promise<void> {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export async function cloneRepository(
    repoUrl: string,
    githubToken?: string,
    options: CloneOptions = {}
): Promise<string> {
    const workRoot = process.env.TEMP || 'C:\\tmp';
    const cloneId = uuidv4();
    const authenticatedUrl = withGithubToken(repoUrl, githubToken);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        const tmpDir = path.join(workRoot, `devoploy-${cloneId}-a${attempt}`);
        const startedAt = Date.now();

        await cleanupDirectory(tmpDir);
        await fs.promises.mkdir(tmpDir, { recursive: true });

        console.log(`[Cloner] Attempt ${attempt}/${MAX_RETRIES}: cloning ${repoUrl} into ${tmpDir}`);

        try {
            const result = await runGitCommand({
                args: ['clone', '--depth=1', '--single-branch', authenticatedUrl, '.'],
                cwd: tmpDir,
                timeoutMs: CLONE_TIMEOUT_MS,
            });

            const structuredLog: CloneAttemptLog = {
                stage: 'cloning',
                attempt,
                duration: result.durationMs,
                status: 'success',
            };
            console.log(JSON.stringify(structuredLog));
            await options.onAttemptLog?.(structuredLog);

            return tmpDir;
        } catch (error) {
            const duration = Date.now() - startedAt;
            const structuredLog: CloneAttemptLog = {
                stage: 'cloning',
                attempt,
                duration,
                status: 'failed',
            };
            console.error(JSON.stringify(structuredLog));
            await options.onAttemptLog?.(structuredLog);

            lastError = error;
            await cleanupDirectory(tmpDir);

            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
                console.warn(`[Cloner] Retry attempt ${attempt + 1} in ${delay}ms`);
                await sleep(delay);
            }
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Clone failed after ${MAX_RETRIES} attempts: ${message}`);
}
