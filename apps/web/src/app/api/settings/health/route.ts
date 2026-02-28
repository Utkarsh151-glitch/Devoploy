import { NextResponse } from 'next/server';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { checkDatabaseHealth } from 'database';
import { getWebhookVerifier } from '@/lib/githubApp';
import { queueName } from '@/lib/queue';

export const runtime = 'nodejs';

function parseRedisUrl(redisUrl: string) {
    const url = new URL(redisUrl);
    return {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: decodeURIComponent(url.username || ''),
        password: decodeURIComponent(url.password || ''),
        db: Number(url.pathname.replace('/', '') || 0),
        tls: url.protocol === 'rediss:' ? {} : undefined,
    };
}

export async function GET() {
    const envChecks = {
        DATABASE_URL: Boolean(process.env.DATABASE_URL),
        REDIS_URL: Boolean(process.env.REDIS_URL),
        GITHUB_APP_ID: Boolean(process.env.GITHUB_APP_ID),
        GITHUB_PRIVATE_KEY: Boolean(process.env.GITHUB_PRIVATE_KEY || process.env.GITHUB_APP_PRIVATE_KEY),
        GITHUB_WEBHOOK_SECRET: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
    };

    const database = { ok: false, error: '' };
    const redis = { ok: false, error: '' };
    const worker = { ok: false, activeWorkers: 0, waitingJobs: 0, activeJobs: 0, failedJobs: 0 };
    const githubApp = { ok: false, webhookUrl: '/api/github/webhook', error: '' };

    try {
        await checkDatabaseHealth();
        database.ok = true;
    } catch (error: unknown) {
        database.error = error instanceof Error ? error.message : 'Database check failed';
    }

    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379/0';
    let redisClient: Redis | null = null;
    try {
        redisClient = new Redis(parseRedisUrl(redisUrl));
        await redisClient.ping();
        redis.ok = true;

        const queue = new Queue(queueName, { connection: parseRedisUrl(redisUrl) });
        const [counts, workers] = await Promise.all([
            queue.getJobCounts('waiting', 'active', 'failed'),
            queue.getWorkers().catch(() => []),
        ]);
        worker.waitingJobs = counts.waiting ?? 0;
        worker.activeJobs = counts.active ?? 0;
        worker.failedJobs = counts.failed ?? 0;
        worker.activeWorkers = workers.length;
        worker.ok = workers.length > 0;
        await queue.close();
    } catch (error: unknown) {
        redis.error = error instanceof Error ? error.message : 'Redis check failed';
    } finally {
        if (redisClient) await redisClient.quit().catch(() => undefined);
    }

    try {
        getWebhookVerifier();
        githubApp.ok = envChecks.GITHUB_APP_ID && envChecks.GITHUB_PRIVATE_KEY && envChecks.GITHUB_WEBHOOK_SECRET;
    } catch (error: unknown) {
        githubApp.error = error instanceof Error ? error.message : 'GitHub App check failed';
    }

    return NextResponse.json({
        envChecks,
        database,
        redis,
        worker,
        githubApp,
    });
}
