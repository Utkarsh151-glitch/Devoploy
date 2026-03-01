import { spawn } from 'child_process';

export interface GitCommandOptions {
    args: string[];
    cwd?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}

export interface GitCommandResult {
    stdout: string;
    stderr: string;
    durationMs: number;
}

function redactSecrets(value: string): string {
    return value
        .replace(/(x-access-token:)[^@]+@/gi, '$1***@')
        .replace(/(ghp_[A-Za-z0-9_]+)/g, '***')
        .replace(/(github_pat_[A-Za-z0-9_]+)/g, '***');
}

export async function runGitCommand(options: GitCommandOptions): Promise<GitCommandResult> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await new Promise<GitCommandResult>((resolve, reject) => {
            const child = spawn('git', options.args, {
                cwd: options.cwd,
                env: { ...process.env, ...options.env },
                windowsHide: true,
                signal: controller.signal,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            child.on('error', (error) => {
                if ((error as Error).name === 'AbortError') {
                    const safeArgs = options.args.map((arg) => redactSecrets(arg));
                    reject(new Error(`git ${safeArgs.join(' ')} timed out after ${timeoutMs}ms`));
                    return;
                }
                reject(error);
            });

            child.on('close', (code) => {
                const durationMs = Date.now() - startedAt;
                if (code !== 0) {
                    const safeArgs = options.args.map((arg) => redactSecrets(arg));
                    const safeStderr = redactSecrets(stderr.trim());
                    const safeStdout = redactSecrets(stdout.trim());
                    reject(
                        new Error(
                            `git ${safeArgs.join(' ')} failed with code ${code}: ${safeStderr || safeStdout}`
                        )
                    );
                    return;
                }

                resolve({
                    stdout,
                    stderr,
                    durationMs,
                });
            });
        });
    } finally {
        clearTimeout(timeout);
    }
}
