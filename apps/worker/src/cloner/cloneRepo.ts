import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export async function cloneRepository(repoUrl: string, githubToken?: string): Promise<string> {
    const tmpDir = path.join(process.env.TEMP || 'C:\\tmp', `devoploy-${uuidv4()}`);

    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    console.log(`[Cloner] Cloning ${repoUrl} into ${tmpDir}...`);

    try {
        await git.clone({
            fs,
            http,
            dir: tmpDir,
            url: repoUrl,
            singleBranch: true,
            depth: 1,
            onAuth: githubToken
                ? () => ({ username: 'x-access-token', password: githubToken })
                : undefined,
        });
        console.log(`[Cloner] Successfully cloned repo.`);
        return tmpDir;
    } catch (error) {
        console.error(`[Cloner] Error cloning repository:`, error);
        throw error;
    }
}
