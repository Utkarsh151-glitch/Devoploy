import fs from 'fs/promises';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

type CloudProvider = 'Vercel' | 'AWS' | 'Heroku' | 'GCP';
type TechStack = 'Node' | 'Python' | 'Go' | 'Static' | 'Unknown';
interface AnalysisResult {
    stack: TechStack;
    entrypoint?: string;
    packageJsonPath?: string;
    isNextApp: boolean;
    issues: DetectedIssue[];
    projectRoot: string;
}

interface DetectedIssue {
    type:
        | 'MISSING_PORT_USAGE'
        | 'HARDCODED_PORT_NUMBER'
        | 'MISSING_NEXT_EXPORT_DEFAULT'
        | 'MISSING_BUILD_SCRIPT'
        | 'INCOMPATIBLE_NODE_ENGINE';
    file: string;
    details: string;
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

export interface ApplyFixesResult {
    changedFiles: string[];
    diffPreview: string;
    rollbackPatchPath: string | null;
}

export async function revertRollbackPatch(repoPath: string, rollbackPatchPath?: string): Promise<void> {
    const patchPath = rollbackPatchPath || path.join(repoPath, '.devoploy', 'rollback.patch.json');
    if (!await fileExists(patchPath)) {
        return;
    }
    const raw = await fs.readFile(patchPath, 'utf8');
    const patch = JSON.parse(raw) as RollbackPatch;
    for (const entry of patch.entries) {
        const absolute = path.join(repoPath, entry.filePath);
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, entry.originalContent, 'utf8');
    }
}

export async function analyzeRepository(repoPath: string): Promise<AnalysisResult> {
    console.log(`[Engine] Analyzing stack at ${repoPath}`);
    return detectStackAndIssues(repoPath);
}

export async function applyFixes(repoPath: string, stackInfo: AnalysisResult, targetCloud: CloudProvider): Promise<ApplyFixesResult> {
    if (stackInfo.stack === 'Unknown') {
        throw new Error('Unsupported Tech Stack');
    }

    console.log(`[Engine] Applying ${targetCloud} fixes for ${stackInfo.stack}...`);
    const changes: FileChange[] = [];
    await applyJsonFixes(repoPath, stackInfo, changes);
    await applyAstFixes(repoPath, stackInfo, changes);
    await injectCloudManifest(repoPath, stackInfo, targetCloud, changes);

    if (changes.length === 0) {
        return { changedFiles: [], diffPreview: 'No changes required.', rollbackPatchPath: null };
    }

    const rollbackPatchPath = await applyChangesTransactionally(repoPath, changes);
    return {
        changedFiles: changes.map((change) => change.filePath),
        diffPreview: changes.map((change) => createDiffPreview(change.filePath, change.before, change.after)).join('\n\n'),
        rollbackPatchPath,
    };
}

export async function analyzeAndFix(repoPath: string, targetCloud: CloudProvider) {
    const stackInfo = await analyzeRepository(repoPath);

    if (stackInfo.stack === 'Unknown') {
        throw new Error('Unsupported Tech Stack');
    }

    await applyFixes(repoPath, stackInfo, targetCloud);
}

async function detectStackAndIssues(repoPath: string): Promise<AnalysisResult> {
    const candidateRoots = await discoverCandidateRoots(repoPath, 4);
    const selectedRoot = await selectProjectRoot(candidateRoots);
    if (!selectedRoot) {
        return { stack: 'Unknown', isNextApp: false, issues: [], projectRoot: repoPath };
    }

    const files = await fs.readdir(selectedRoot);
    const issues: DetectedIssue[] = [];
    const packageJsonPath = path.join(selectedRoot, 'package.json');
    const hasPackageJson = files.includes('package.json');
    const isNextApp = await fileExists(path.join(selectedRoot, 'app', 'page.tsx')) || await fileExists(path.join(selectedRoot, 'src', 'app', 'page.tsx'));

    if (hasPackageJson) {
        const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        const fallbackEntrypoint = ['index.js', 'server.js', 'app.js'].find((file) => files.includes(file));
        const entrypoint = pkg.main || fallbackEntrypoint || 'index.js';
        await detectJsonIssues(packageJsonPath, pkg, issues);
        await detectAstIssues(selectedRoot, entrypoint, isNextApp, issues);
        return { stack: 'Node', entrypoint, packageJsonPath, isNextApp, issues, projectRoot: selectedRoot };
    }

    if (files.includes('requirements.txt') || files.includes('Pipfile')) {
        return { stack: 'Python', entrypoint: 'app.py', isNextApp: false, issues, projectRoot: selectedRoot };
    }
    if (files.includes('go.mod')) {
        return { stack: 'Go', entrypoint: 'main.go', isNextApp: false, issues, projectRoot: selectedRoot };
    }
    if (files.includes('index.html')) {
        return { stack: 'Static', entrypoint: 'index.html', isNextApp: false, issues, projectRoot: selectedRoot };
    }

    return { stack: 'Unknown', isNextApp: false, issues, projectRoot: selectedRoot };
}

async function detectJsonIssues(packageJsonPath: string, pkg: any, issues: DetectedIssue[]): Promise<void> {
    if (!pkg.scripts || typeof pkg.scripts.build !== 'string' || pkg.scripts.build.trim() === '') {
        issues.push({ type: 'MISSING_BUILD_SCRIPT', file: packageJsonPath, details: 'package.json missing scripts.build' });
    }

    const nodeEngine: string | undefined = pkg.engines?.node;
    if (!isCompatibleNodeEngine(nodeEngine)) {
        issues.push({
            type: 'INCOMPATIBLE_NODE_ENGINE',
            file: packageJsonPath,
            details: `engines.node is ${nodeEngine ?? 'missing'}`,
        });
    }
}

async function detectAstIssues(repoPath: string, entrypoint: string, isNextApp: boolean, issues: DetectedIssue[]): Promise<void> {
    const entryPath = path.join(repoPath, entrypoint);
    if (await fileExists(entryPath)) {
        const source = await fs.readFile(entryPath, 'utf8');
        const ast = parseSource(source, entryPath);
        let sawListenCall = false;
        let usesPortVar = false;
        let hasHardcodedPort = false;

        traverse(ast, {
            VariableDeclarator(p) {
                if (t.isIdentifier(p.node.id, { name: 'PORT' })) {
                    usesPortVar = true;
                }
            },
            MemberExpression(p) {
                if (
                    t.isMemberExpression(p.node.object) &&
                    t.isIdentifier(p.node.object.object, { name: 'process' }) &&
                    t.isIdentifier(p.node.object.property, { name: 'env' }) &&
                    t.isIdentifier(p.node.property, { name: 'PORT' })
                ) {
                    usesPortVar = true;
                }
            },
            CallExpression(p) {
                if (t.isMemberExpression(p.node.callee) && t.isIdentifier(p.node.callee.property, { name: 'listen' })) {
                    sawListenCall = true;
                    const first = p.node.arguments[0];
                    if (t.isNumericLiteral(first)) {
                        hasHardcodedPort = true;
                    }
                    if (!isPortExpression(first)) {
                        usesPortVar = false;
                    }
                }
            },
        });

        if (sawListenCall && !usesPortVar) {
            issues.push({ type: 'MISSING_PORT_USAGE', file: entryPath, details: 'listen() call does not use process.env.PORT or PORT variable' });
        }
        if (hasHardcodedPort) {
            issues.push({ type: 'HARDCODED_PORT_NUMBER', file: entryPath, details: 'listen() call has numeric literal port' });
        }
    }

    if (isNextApp) {
        const nextFiles = [path.join(repoPath, 'app', 'page.tsx'), path.join(repoPath, 'src', 'app', 'page.tsx')];
        for (const filePath of nextFiles) {
            if (!await fileExists(filePath)) continue;
            const source = await fs.readFile(filePath, 'utf8');
            const ast = parseSource(source, filePath);
            let hasDefault = false;
            traverse(ast, {
                ExportDefaultDeclaration(p) {
                    hasDefault = true;
                    p.stop();
                },
            });
            if (!hasDefault) {
                issues.push({ type: 'MISSING_NEXT_EXPORT_DEFAULT', file: filePath, details: 'Next app page missing export default' });
            }
        }
    }
}

async function applyJsonFixes(repoPath: string, stackInfo: AnalysisResult, changes: FileChange[]): Promise<void> {
    if (!stackInfo.packageJsonPath || !await fileExists(stackInfo.packageJsonPath)) return;
    const before = await fs.readFile(stackInfo.packageJsonPath, 'utf8');
    const pkg = JSON.parse(before);
    let touched = false;

    if (!pkg.scripts || typeof pkg.scripts !== 'object') {
        pkg.scripts = {};
    }
    if (!pkg.scripts.build || typeof pkg.scripts.build !== 'string' || pkg.scripts.build.trim() === '') {
        pkg.scripts.build = 'npm run start';
        touched = true;
    }

    if (!pkg.engines || typeof pkg.engines !== 'object') {
        pkg.engines = {};
    }
    if (!isCompatibleNodeEngine(pkg.engines.node)) {
        pkg.engines.node = '>=20';
        touched = true;
    }

    if (touched) {
        const after = `${JSON.stringify(pkg, null, 2)}\n`;
        changes.push({ filePath: stackInfo.packageJsonPath, before, after });
    }
}

async function applyAstFixes(repoPath: string, stackInfo: AnalysisResult, changes: FileChange[]): Promise<void> {
    if (stackInfo.stack !== 'Node' || !stackInfo.entrypoint) return;

    const entryPath = path.join(stackInfo.projectRoot, stackInfo.entrypoint);
    if (await fileExists(entryPath)) {
        const before = await fs.readFile(entryPath, 'utf8');
        const ast = parseSource(before, entryPath);
        let changed = false;
        let hasPortDeclaration = false;
        let needsPortDeclaration = false;

        traverse(ast, {
            VariableDeclarator(p) {
                if (t.isIdentifier(p.node.id, { name: 'PORT' })) {
                    hasPortDeclaration = true;
                }
            },
            CallExpression(p) {
                if (t.isMemberExpression(p.node.callee) && t.isIdentifier(p.node.callee.property, { name: 'listen' })) {
                    const first = p.node.arguments[0];
                    if (!isPortExpression(first)) {
                        p.node.arguments[0] = t.identifier('PORT');
                        needsPortDeclaration = true;
                        changed = true;
                    }
                }
            },
        });

        if (needsPortDeclaration && !hasPortDeclaration) {
            ast.program.body.unshift(
                t.variableDeclaration('const', [
                    t.variableDeclarator(
                        t.identifier('PORT'),
                        t.callExpression(t.identifier('Number'), [
                            t.logicalExpression(
                                '??',
                                t.memberExpression(
                                    t.memberExpression(t.identifier('process'), t.identifier('env')),
                                    t.identifier('PORT')
                                ),
                                t.numericLiteral(3000)
                            ),
                        ])
                    ),
                ])
            );
            changed = true;
        }

        if (changed) {
            const after = generate(ast, { retainLines: false }, before).code;
            if (after !== before) {
                changes.push({ filePath: entryPath, before, after });
            }
        }
    }

    const nextPageCandidates = [path.join(stackInfo.projectRoot, 'app', 'page.tsx'), path.join(stackInfo.projectRoot, 'src', 'app', 'page.tsx')];
    for (const pagePath of nextPageCandidates) {
        if (!await fileExists(pagePath)) continue;
        const before = await fs.readFile(pagePath, 'utf8');
        const ast = parseSource(before, pagePath);
        let hasDefault = false;
        let fallbackIdentifier: t.Identifier | null = null;

        traverse(ast, {
            ExportDefaultDeclaration(p) {
                hasDefault = true;
                p.stop();
            },
            FunctionDeclaration(p) {
                if (!fallbackIdentifier && p.node.id) {
                    fallbackIdentifier = t.identifier(p.node.id.name);
                }
            },
            VariableDeclarator(p) {
                if (!fallbackIdentifier && t.isIdentifier(p.node.id)) {
                    fallbackIdentifier = t.identifier(p.node.id.name);
                }
            },
        });

        if (!hasDefault && fallbackIdentifier) {
            ast.program.body.push(t.exportDefaultDeclaration(fallbackIdentifier));
            const after = generate(ast, { retainLines: false }, before).code;
            if (after !== before) {
                changes.push({ filePath: pagePath, before, after });
            }
        }
    }
}

async function injectCloudManifest(repoPath: string, config: AnalysisResult, targetCloud: CloudProvider, changes: FileChange[]): Promise<void> {
    const baseRoot = config.projectRoot || repoPath;
    if (targetCloud === 'Vercel') {
        const vercelPath = path.join(baseRoot, 'vercel.json');
        const before = await readFileOrEmpty(vercelPath);
        const vercelConfig = config.stack === 'Static'
            ? { version: 2, cleanUrls: true }
            : {
                version: 2,
                builds: config.stack === 'Node' ? [{ src: config.entrypoint, use: '@vercel/node' }] :
                    config.stack === 'Python' ? [{ src: config.entrypoint, use: '@vercel/python' }] :
                        [{ src: config.entrypoint, use: '@vercel/go' }],
                routes: [{ src: '/(.*)', dest: `/${config.entrypoint}` }],
            };
        const after = `${JSON.stringify(vercelConfig, null, 2)}\n`;
        if (before !== after) {
            changes.push({ filePath: vercelPath, before, after });
        }
        return;
    }

    if (targetCloud === 'Heroku') {
        const procPath = path.join(baseRoot, 'Procfile');
        const before = await readFileOrEmpty(procPath);
        let after = '';
        if (config.stack === 'Node') after = `web: node ${config.entrypoint}\n`;
        if (config.stack === 'Python') after = `web: gunicorn ${config.entrypoint?.replace('.py', ':app')}\n`;
        if (config.stack === 'Go') after = `web: bin/${path.basename(baseRoot)}\n`;
        if (config.stack === 'Static') after = 'web: npx serve .\n';
        if (before !== after) {
            changes.push({ filePath: procPath, before, after });
        }
        return;
    }

    if (targetCloud === 'AWS') {
        const sstPath = path.join(baseRoot, 'sst.config.ts');
        const before = await readFileOrEmpty(sstPath);
        const after = `
import { SSTConfig } from "sst";
import { Api } from "sst/constructs";

export default {
  config(_input) {
    return { name: "devoploy-aws-app", region: "us-east-1" };
  },
  stacks(app) {
    app.stack(function Site({ stack }) {
      const api = new Api(stack, "api", {
        routes: { "ANY /{proxy+}": "${config.entrypoint}" },
      });
      stack.addOutputs({ ApiEndpoint: api.url });
    });
  }
} satisfies SSTConfig;
`;
        if (before !== after.trim() + '\n') {
            changes.push({ filePath: sstPath, before, after: `${after.trim()}\n` });
        }
    }
}

async function applyChangesTransactionally(repoPath: string, changes: FileChange[]): Promise<string> {
    const applied: FileChange[] = [];
    const rollback: RollbackPatch = {
        createdAt: new Date().toISOString(),
        entries: [],
    };

    try {
        for (const change of changes) {
            await fs.mkdir(path.dirname(change.filePath), { recursive: true });
            rollback.entries.push({
                filePath: path.relative(repoPath, change.filePath),
                originalContent: change.before,
            });
            await fs.writeFile(change.filePath, change.after, 'utf8');
            applied.push(change);
        }
    } catch (error) {
        for (const change of applied.reverse()) {
            await fs.writeFile(change.filePath, change.before, 'utf8').catch(() => undefined);
        }
        throw error;
    }

    const rollbackDir = path.join(repoPath, '.devoploy');
    await fs.mkdir(rollbackDir, { recursive: true });
    const rollbackPatchPath = path.join(rollbackDir, 'rollback.patch.json');
    await fs.writeFile(rollbackPatchPath, JSON.stringify(rollback, null, 2), 'utf8');
    return rollbackPatchPath;
}

async function discoverCandidateRoots(root: string, maxDepth: number): Promise<string[]> {
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    const candidates: string[] = [];
    const skipDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);

    while (queue.length > 0) {
        const current = queue.shift()!;
        const entries = await fs.readdir(current.dir, { withFileTypes: true });
        const names = new Set(entries.map((entry) => entry.name));

        if (names.has('package.json') || names.has('requirements.txt') || names.has('Pipfile') || names.has('go.mod') || names.has('index.html')) {
            candidates.push(current.dir);
        }

        if (current.depth >= maxDepth) continue;

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (skipDirs.has(entry.name)) continue;
            queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
        }
    }

    return candidates;
}

async function selectProjectRoot(candidates: string[]): Promise<string | null> {
    if (candidates.length === 0) return null;

    const scored: Array<{ dir: string; score: number }> = [];
    for (const dir of candidates) {
        const files = new Set(await fs.readdir(dir));
        let score = 0;
        if (files.has('package.json')) score += 100;
        if (files.has('requirements.txt') || files.has('Pipfile')) score += 80;
        if (files.has('go.mod')) score += 70;
        if (files.has('index.html')) score += 30;
        if (await fileExists(path.join(dir, 'app', 'page.tsx'))) score += 40;
        if (await fileExists(path.join(dir, 'src', 'app', 'page.tsx'))) score += 40;
        if (await fileExists(path.join(dir, 'next.config.js')) || await fileExists(path.join(dir, 'next.config.ts'))) score += 30;
        if (await fileExists(path.join(dir, 'vercel.json'))) score += 20;
        // prefer shallower candidates if score ties
        score -= dir.split(path.sep).length;
        scored.push({ dir, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0].dir;
}

function parseSource(source: string, filePath: string) {
    const isTs = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
    const isJsx = filePath.endsWith('.jsx') || filePath.endsWith('.tsx');
    return parse(source, {
        sourceType: 'unambiguous',
        plugins: [
            isTs ? 'typescript' : null,
            isJsx ? 'jsx' : null,
        ].filter(Boolean) as any,
    });
}

function isPortExpression(node: t.Node | t.SpreadElement | t.ArgumentPlaceholder | undefined): boolean {
    if (!node) return false;
    if (t.isIdentifier(node, { name: 'PORT' })) return true;
    if (
        t.isMemberExpression(node) &&
        t.isMemberExpression(node.object) &&
        t.isIdentifier(node.object.object, { name: 'process' }) &&
        t.isIdentifier(node.object.property, { name: 'env' }) &&
        t.isIdentifier(node.property, { name: 'PORT' })
    ) {
        return true;
    }
    if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'Number' })) {
        return node.arguments.some((arg) => isPortExpression(arg as t.Node));
    }
    if (t.isLogicalExpression(node)) {
        return isPortExpression(node.left) || isPortExpression(node.right);
    }
    return false;
}

function isCompatibleNodeEngine(range: unknown): boolean {
    if (typeof range !== 'string' || !range.trim()) return false;
    if (/(>=\s*20|\^20|~20|20\.x|>=\s*18)/.test(range)) return true;
    const match = range.match(/\d+/);
    if (!match) return false;
    return Number(match[0]) >= 18;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function readFileOrEmpty(filePath: string): Promise<string> {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return '';
    }
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
