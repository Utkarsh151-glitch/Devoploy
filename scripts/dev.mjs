import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npmExecPath = process.env.npm_execpath;
const repoRoot = process.cwd();

function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx < 1) continue;
        const key = trimmed.slice(0, idx).trim();
        let value = trimmed.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value.replace(/\\n/g, '\n');
    }
    return env;
}

const fileEnv = {
    ...parseEnvFile(path.join(repoRoot, '.env')),
    ...parseEnvFile(path.join(repoRoot, '.env.local')),
};
const sharedEnv = { ...fileEnv, ...process.env };

function start(name, color, args) {
    const cmd = npmExecPath ? process.execPath : 'npm';
    const finalArgs = npmExecPath ? [npmExecPath, ...args] : args;

    const child = spawn(cmd, finalArgs, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: sharedEnv,
    });

    child.stdout.on('data', (data) => {
        process.stdout.write(`\x1b[${color}m[${name}]\x1b[0m ${data}`);
    });

    child.stderr.on('data', (data) => {
        process.stderr.write(`\x1b[${color}m[${name}]\x1b[0m ${data}`);
    });

    return child;
}

const web = start('web', '36', ['run', 'dev:web']);
const worker = start('worker', '32', ['run', 'dev:worker']);

let shuttingDown = false;

function shutdown(signal = 'SIGTERM') {
    if (shuttingDown) return;
    shuttingDown = true;
    web.kill(signal);
    worker.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

web.on('exit', (code) => {
    if (!shuttingDown) {
        console.error(`[web] exited with code ${code}`);
        shutdown();
        process.exit(code ?? 1);
    }
});

worker.on('exit', (code) => {
    if (!shuttingDown) {
        console.error(`[worker] exited with code ${code}`);
        shutdown();
        process.exit(code ?? 1);
    }
});
