import { Job, Worker } from 'bullmq';
import { DeploymentJobPayload } from 'database';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379/0';
export const queueName = process.env.DEPLOYMENT_QUEUE_NAME || 'deployment-jobs';

if (!process.env.REDIS_URL) {
    console.warn('[Worker] REDIS_URL not set. Using default redis://127.0.0.1:6379/0');
}

if (!redisUrl.startsWith('redis')) {
    throw new Error('REDIS_URL must start with redis:// or rediss://');
}

const url = new URL(redisUrl);
export const redisConnection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    db: Number(url.pathname.replace('/', '') || 0),
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null as null,
};

export function createDeploymentWorker(
    processor: (job: Job<DeploymentJobPayload>) => Promise<void>
): Worker {
    return new Worker(queueName, processor, {
        connection: redisConnection,
        concurrency: Number(process.env.WORKER_CONCURRENCY || 3),
    });
}
