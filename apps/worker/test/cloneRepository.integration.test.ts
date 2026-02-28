import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { cloneRepository } from '../src/cloner/cloneRepo';
import { runGitCommand } from '../src/git/runGitCommand';

async function createTempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('cloneRepository performs a shallow clone from a local git repository', async () => {
    const sourceDir = await createTempDir('devoploy-source-');
    const originalTemp = process.env.TEMP;
    const cloneRoot = await createTempDir('devoploy-clones-');
    process.env.TEMP = cloneRoot;

    try {
        await runGitCommand({ args: ['init'], cwd: sourceDir });
        await runGitCommand({ args: ['config', 'user.name', 'Integration Test'], cwd: sourceDir });
        await runGitCommand({ args: ['config', 'user.email', 'integration@example.com'], cwd: sourceDir });

        const filePath = path.join(sourceDir, 'README.md');
        await fs.writeFile(filePath, '# sample\n', 'utf8');
        await runGitCommand({ args: ['add', '.'], cwd: sourceDir });
        await runGitCommand({ args: ['commit', '-m', 'initial'], cwd: sourceDir });

        const clonedPath = await cloneRepository(sourceDir);
        const clonedReadme = await fs.readFile(path.join(clonedPath, 'README.md'), 'utf8');
        assert.match(clonedReadme, /sample/);
    } finally {
        process.env.TEMP = originalTemp;
        await fs.rm(sourceDir, { recursive: true, force: true });
        await fs.rm(cloneRoot, { recursive: true, force: true });
    }
});
