import { App } from '@octokit/app';
import { Webhooks } from '@octokit/webhooks';
import JSZip from 'jszip';
import type { ClassifiedCiError } from 'ci-parser';
import fs from 'fs';

export interface WorkflowRunContext {
    installationId: number;
    owner: string;
    repo: string;
    runId: number;
    workflowName?: string;
    headBranch: string;
    headSha: string;
    htmlUrl?: string;
}

interface PatchResult {
    branch: string;
    changedFiles: string[];
}

let appInstance: App | null = null;
let webhookVerifier: Webhooks | null = null;

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required.`);
    }
    return value;
}

function resolveGithubPrivateKey(): string {
    const fromPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    if (fromPath) {
        if (!fs.existsSync(fromPath)) {
            throw new Error(`GITHUB_APP_PRIVATE_KEY_PATH file not found: ${fromPath}`);
        }
        return fs.readFileSync(fromPath, 'utf8');
    }

    const inline = requiredEnv('GITHUB_APP_PRIVATE_KEY');
    // Support both escaped "\n" and literal PEM new lines.
    return inline.replace(/\\n/g, '\n');
}

function getApp(): App {
    if (!appInstance) {
        appInstance = new App({
            appId: requiredEnv('GITHUB_APP_ID'),
            privateKey: resolveGithubPrivateKey(),
            webhooks: {
                secret: requiredEnv('GITHUB_WEBHOOK_SECRET'),
            },
        });
    }
    return appInstance;
}

export function getWebhookVerifier(): Webhooks {
    if (!webhookVerifier) {
        webhookVerifier = new Webhooks({ secret: requiredEnv('GITHUB_WEBHOOK_SECRET') });
    }
    return webhookVerifier;
}

export async function getInstallationOctokit(installationId: number) {
    return getApp().getInstallationOctokit(installationId);
}

export async function fetchWorkflowRunLogs(context: WorkflowRunContext): Promise<string> {
    const octokit = await getInstallationOctokit(context.installationId);
    const response = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs', {
        owner: context.owner,
        repo: context.repo,
        run_id: context.runId,
        request: { redirect: 'manual' as RequestRedirect },
    });

    const location = response.headers.location;
    if (!location) {
        throw new Error('GitHub did not return a workflow logs redirect URL.');
    }

    const zipResponse = await fetch(location);
    if (!zipResponse.ok) {
        throw new Error(`Failed to download workflow logs: ${zipResponse.status}`);
    }

    const buffer = await zipResponse.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);

    const entries = Object.values(zip.files).filter((file) => !file.dir);
    const chunks = await Promise.all(entries.map((file) => file.async('string')));
    return chunks.join('\n\n');
}

async function getDefaultBranch(installationId: number, owner: string, repo: string): Promise<string> {
    const octokit = await getInstallationOctokit(installationId);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });
    return data.default_branch;
}

async function ensureBranchExists(
    installationId: number,
    owner: string,
    repo: string,
    branch: string,
    baseSha: string
): Promise<void> {
    const octokit = await getInstallationOctokit(installationId);
    try {
        await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
            owner,
            repo,
            ref: `heads/${branch}`,
        });
    } catch {
        await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
            owner,
            repo,
            ref: `refs/heads/${branch}`,
            sha: baseSha,
        });
    }
}

async function getFileIfExists(
    installationId: number,
    owner: string,
    repo: string,
    path: string,
    ref: string
): Promise<{ content: string; sha: string } | null> {
    const octokit = await getInstallationOctokit(installationId);
    try {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
            owner,
            repo,
            path,
            ref,
        });

        if (!('content' in data) || data.type !== 'file') {
            return null;
        }

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return { content, sha: data.sha };
    } catch {
        return null;
    }
}

async function upsertFile(
    installationId: number,
    owner: string,
    repo: string,
    branch: string,
    filePath: string,
    content: string,
    commitMessage: string
): Promise<void> {
    const existing = await getFileIfExists(installationId, owner, repo, filePath, branch);
    const octokit = await getInstallationOctokit(installationId);

    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path: filePath,
        branch,
        message: commitMessage,
        content: Buffer.from(content, 'utf8').toString('base64'),
        sha: existing?.sha,
    });
}

function suggestedPatchFile(classified: ClassifiedCiError): { path: string; content: string } {
    const summary = [
        '# Devoploy CI Failure Analysis',
        '',
        `- Category: ${classified.category}`,
        `- Confidence: ${classified.confidence}`,
        `- Suggested fix: ${classified.suggestedFixType}`,
        '',
        '## Extracted Error',
        '```',
        classified.extractedError.slice(0, 6000),
        '```',
        '',
    ].join('\n');

    if (classified.category === 'NODE_VERSION_MISMATCH') {
        return { path: '.nvmrc', content: '20\n' };
    }

    if (classified.category === 'ENV_VARIABLE_MISSING') {
        const envVar = classified.extractedError.match(/[A-Z][A-Z0-9_]{2,}/)?.[0] || 'REQUIRED_ENV_VAR';
        return { path: '.env.example', content: `${envVar}=\n` };
    }

    if (classified.category === 'BUILD_SCRIPT_MISSING') {
        return {
            path: 'devoploy.analysis.md',
            content: `${summary}\nBuild script appears missing. Please add a valid \`build\` script in package.json.\n`,
        };
    }

    return { path: 'devoploy.analysis.md', content: summary };
}

export async function applyFixPatch(context: WorkflowRunContext, classified: ClassifiedCiError): Promise<PatchResult> {
    const branch = `devoploy/fix-workflow-${context.runId}`;
    await ensureBranchExists(context.installationId, context.owner, context.repo, branch, context.headSha);

    const patch = suggestedPatchFile(classified);
    await upsertFile(
        context.installationId,
        context.owner,
        context.repo,
        branch,
        patch.path,
        patch.content,
        `chore(devoploy): apply ${classified.suggestedFixType}`
    );

    return { branch, changedFiles: [patch.path] };
}

export async function openPullRequest(
    context: WorkflowRunContext,
    branch: string,
    classified: ClassifiedCiError
): Promise<number> {
    const octokit = await getInstallationOctokit(context.installationId);
    const base = await getDefaultBranch(context.installationId, context.owner, context.repo);
    const head = `${context.owner}:${branch}`;

    const existing = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
        owner: context.owner,
        repo: context.repo,
        state: 'open',
        head,
        base,
    });

    if (existing.data.length > 0) {
        return existing.data[0].number;
    }

    const pr = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
        owner: context.owner,
        repo: context.repo,
        title: `fix(ci): address ${classified.category.toLowerCase()}`,
        head: branch,
        base,
        body: [
            'Automated patch from Devoploy GitHub App.',
            '',
            `Category: ${classified.category}`,
            `Confidence: ${classified.confidence}`,
            `Suggested fix: ${classified.suggestedFixType}`,
        ].join('\n'),
    });

    return pr.data.number;
}

export async function commentAnalysisSummary(
    context: WorkflowRunContext,
    prNumber: number,
    classified: ClassifiedCiError,
    contextualSuggestion?: string
): Promise<void> {
    const octokit = await getInstallationOctokit(context.installationId);
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner: context.owner,
        repo: context.repo,
        issue_number: prNumber,
        body: [
            '### Deployment Analysis Summary',
            `- Category: \`${classified.category}\``,
            `- Confidence: \`${classified.confidence}\``,
            `- Suggested fix type: \`${classified.suggestedFixType}\``,
            '',
            '#### Extracted Error',
            '```',
            classified.extractedError.slice(0, 4000),
            '```',
            contextualSuggestion ? '\n#### Contextual Fix Suggestion (RAG)\n' + contextualSuggestion : '',
            context.htmlUrl ? `\nWorkflow run: ${context.htmlUrl}` : '',
        ].join('\n'),
    });
}
