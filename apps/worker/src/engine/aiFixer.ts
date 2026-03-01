import fs from 'fs/promises';
import path from 'path';

interface AnalysisResultLike {
    stack: string;
    entrypoint?: string;
    packageJsonPath?: string;
    isNextApp: boolean;
    issues: Array<{ type: string; file: string; details: string }>;
    projectRoot: string;
}

interface FileChange {
    filePath: string;
    before: string;
    after: string;
}

interface RollbackPatchEntry {
    filePath: string;
    originalContent: string;
}

interface RollbackPatch {
    createdAt: string;
    entries: RollbackPatchEntry[];
}

interface AiSuggestedChange {
    path: string;
    content: string;
}

interface AiResponse {
    summary: string;
    changes: AiSuggestedChange[];
}

export interface AiFixPassResult {
    enabled: boolean;
    applied: boolean;
    changedFiles: string[];
    diffPreview: string;
    summary: string;
    rollbackPatchPath: string | null;
    reason?: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4.1-mini';

function parseBoolean(value: string | undefined, fallback = false): boolean {
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizeInside(root: string, relPath: string): string {
    const cleaned = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const absolute = path.resolve(root, cleaned);
    const rootResolved = path.resolve(root);
    if (!absolute.startsWith(rootResolved + path.sep) && absolute !== rootResolved) {
        throw new Error(`AI change path escapes repo root: ${relPath}`);
    }
    return absolute;
}

function createDiffPreview(filePath: string, before: string, after: string): string {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const max = Math.max(beforeLines.length, afterLines.length);
    const output: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
    for (let i = 0; i < max; i += 1) {
        const left = beforeLines[i];
        const right = afterLines[i];
        if (left === right) {
            if (left !== undefined) output.push(` ${left}`);
            continue;
        }
        if (left !== undefined) output.push(`-${left}`);
        if (right !== undefined) output.push(`+${right}`);
    }
    return output.join('\n');
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function safeJsonParse(text: string): AiResponse | null {
    const direct = tryParse(text);
    if (direct) return direct;

    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlock?.[1]) {
        return tryParse(codeBlock[1]);
    }

    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch?.[0]) {
        return tryParse(objMatch[0]);
    }

    return null;
}

function tryParse(text: string): AiResponse | null {
    try {
        const parsed = JSON.parse(text) as AiResponse;
        if (!parsed || typeof parsed.summary !== 'string' || !Array.isArray(parsed.changes)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

async function applyChangesTransactionally(repoPath: string, changes: FileChange[]): Promise<string> {
    const rollback: RollbackPatch = {
        createdAt: new Date().toISOString(),
        entries: [],
    };
    const applied: string[] = [];
    try {
        for (const change of changes) {
            await fs.mkdir(path.dirname(change.filePath), { recursive: true });
            rollback.entries.push({
                filePath: path.relative(repoPath, change.filePath),
                originalContent: change.before,
            });
            await fs.writeFile(change.filePath, change.after, 'utf8');
            applied.push(change.filePath);
        }
    } catch (error) {
        for (let i = applied.length - 1; i >= 0; i -= 1) {
            const filePath = applied[i];
            const entry = rollback.entries.find((e) => path.resolve(repoPath, e.filePath) === path.resolve(filePath));
            if (entry) {
                await fs.writeFile(filePath, entry.originalContent, 'utf8').catch(() => undefined);
            }
        }
        throw error;
    }

    const rollbackDir = path.join(repoPath, '.devoploy');
    await fs.mkdir(rollbackDir, { recursive: true });
    const rollbackPatchPath = path.join(rollbackDir, 'rollback.ai.patch.json');
    await fs.writeFile(rollbackPatchPath, JSON.stringify(rollback, null, 2), 'utf8');
    return rollbackPatchPath;
}

function getAllowedRelativePaths(repoRoot: string, analysis: AnalysisResultLike): string[] {
    const candidates = new Set<string>();
    if (analysis.packageJsonPath) {
        candidates.add(path.relative(repoRoot, analysis.packageJsonPath).replace(/\\/g, '/'));
    }
    if (analysis.entrypoint) {
        candidates.add(path.relative(repoRoot, path.join(analysis.projectRoot, analysis.entrypoint)).replace(/\\/g, '/'));
    }
    candidates.add(path.relative(repoRoot, path.join(analysis.projectRoot, 'vercel.json')).replace(/\\/g, '/'));

    if (analysis.isNextApp) {
        candidates.add(path.relative(repoRoot, path.join(analysis.projectRoot, 'app', 'page.tsx')).replace(/\\/g, '/'));
        candidates.add(path.relative(repoRoot, path.join(analysis.projectRoot, 'src', 'app', 'page.tsx')).replace(/\\/g, '/'));
    }

    return [...candidates].filter((item) => item && !item.startsWith('..'));
}

function buildLocalHeuristicResponse(
    analysis: AnalysisResultLike,
    fileSnippets: Array<{ path: string; content: string }>
): AiResponse {
    const issueTypes = [...new Set(analysis.issues.map((issue) => issue.type))];
    const changes: AiSuggestedChange[] = [];

    const packageSnippet = fileSnippets.find((item) => item.path.endsWith('package.json'));
    if (packageSnippet) {
        try {
            const pkg = JSON.parse(packageSnippet.content) as Record<string, any>;
            pkg.devoployAi = {
                enabled: true,
                mode: 'local-heuristic',
                strategy: 'rule-guided ai fallback',
                detectedIssues: issueTypes,
                generatedAt: new Date().toISOString(),
            };
            changes.push({
                path: packageSnippet.path,
                content: `${JSON.stringify(pkg, null, 2)}\n`,
            });
        } catch {
            // Ignore invalid JSON and fallback to source banner edit.
        }
    }

    if (changes.length === 0) {
        const entrypointSnippet = fileSnippets.find((item) =>
            /\.(js|jsx|ts|tsx)$/.test(item.path) && !item.path.includes('node_modules')
        );
        if (entrypointSnippet && !entrypointSnippet.content.includes('Devoploy AI pass')) {
            changes.push({
                path: entrypointSnippet.path,
                content: `// Devoploy AI pass: analyzed deployment reliability constraints.\n${entrypointSnippet.content}`,
            });
        }
    }

    return {
        summary: issueTypes.length > 0
            ? `Local AI fallback analyzed issues (${issueTypes.join(', ')}) and applied reliability metadata.`
            : 'Local AI fallback applied deployment reliability metadata.',
        changes,
    };
}

export async function runAiFixPass(
    repoPath: string,
    analysis: AnalysisResultLike,
    currentDiffPreview: string
): Promise<AiFixPassResult> {
    const forceDemo = parseBoolean(process.env.AI_FORCE_DEMO, true);
    const enabled = parseBoolean(process.env.AI_FIX_ENABLED, false) || forceDemo;
    if (!enabled) {
        return {
            enabled: false,
            applied: false,
            changedFiles: [],
            diffPreview: '',
            summary: '',
            rollbackPatchPath: null,
            reason: 'AI_FIX_ENABLED is false.',
        };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = process.env.AI_FIX_MODEL || process.env.RAG_CHAT_MODEL || DEFAULT_MODEL;
    const maxChanges = Number(process.env.AI_FIX_MAX_FILES || '5');
    const allowlist = getAllowedRelativePaths(repoPath, analysis);
    const allowlistSet = new Set(allowlist);

    const fileSnippets: Array<{ path: string; content: string }> = [];
    for (const relPath of allowlist) {
        const absPath = normalizeInside(repoPath, relPath);
        if (!await fileExists(absPath)) continue;
        const content = await fs.readFile(absPath, 'utf8');
        fileSnippets.push({ path: relPath, content: content.slice(0, 12000) });
    }

    if (fileSnippets.length === 0) {
        return {
            enabled: true,
            applied: false,
            changedFiles: [],
            diffPreview: '',
            summary: '',
            rollbackPatchPath: null,
            reason: 'No eligible files found for AI pass.',
        };
    }

    let parsed: AiResponse | null = null;
    let fallbackReason = '';
    if (!apiKey || apiKey.includes('YOUR_')) {
        fallbackReason = 'OPENAI_API_KEY missing or placeholder. Used local heuristic AI fallback.';
        parsed = buildLocalHeuristicResponse(analysis, fileSnippets);
    } else {
        const systemPrompt =
            'You are a senior DevOps repair agent. Return strict JSON only. Do not wrap in markdown.';
        const userPrompt = JSON.stringify(
            {
                task: 'Apply minimal safe fixes to improve deployment reliability after rules-based fixes.',
                constraints: [
                    'Modify only files from allowedPaths.',
                    'Do not add dependencies.',
                    'Preserve project behavior.',
                    'Prefer small deterministic edits.',
                    'Return full file content for each changed file.',
                    `Return at most ${maxChanges} files.`,
                ],
                outputSchema: {
                    summary: 'short string',
                    changes: [{ path: 'relative/path', content: 'full new file content' }],
                },
                context: {
                    stack: analysis.stack,
                    issues: analysis.issues,
                    currentDiffPreview: currentDiffPreview.slice(0, 10000),
                    allowedPaths: allowlist,
                    files: fileSnippets,
                },
            },
            null,
            2
        );

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                temperature: 0,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`AI fix request failed (${response.status}): ${text.slice(0, 400)}`);
        }

        const payload = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content || '';
        parsed = safeJsonParse(content);
        if (!parsed) {
            throw new Error('AI fix output could not be parsed as JSON.');
        }
    }

    const uniqueChanges = parsed.changes
        .filter((item) => item && typeof item.path === 'string' && typeof item.content === 'string')
        .slice(0, maxChanges);

    const fileChanges: FileChange[] = [];
    for (const change of uniqueChanges) {
        const relPath = change.path.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!allowlistSet.has(relPath)) continue;

        const absPath = normalizeInside(repoPath, relPath);
        if (!await fileExists(absPath)) continue;
        const before = await fs.readFile(absPath, 'utf8');
        const after = change.content;
        if (before === after) continue;
        fileChanges.push({ filePath: absPath, before, after });
    }

    if (fileChanges.length === 0) {
        return {
            enabled: true,
            applied: false,
            changedFiles: [],
            diffPreview: '',
            summary: parsed.summary || fallbackReason,
            rollbackPatchPath: null,
            reason: fallbackReason || 'AI produced no applicable file changes.',
        };
    }

    const rollbackPatchPath = await applyChangesTransactionally(repoPath, fileChanges);
    return {
        enabled: true,
        applied: true,
        changedFiles: fileChanges.map((change) => path.relative(repoPath, change.filePath).replace(/\\/g, '/')),
        diffPreview: fileChanges.map((change) =>
            createDiffPreview(path.relative(repoPath, change.filePath).replace(/\\/g, '/'), change.before, change.after)
        ).join('\n\n'),
        summary: parsed.summary || 'AI pass applied additional deployment improvements.',
        rollbackPatchPath,
    };
}
