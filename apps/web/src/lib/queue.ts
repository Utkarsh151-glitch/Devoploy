import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379/0';
const queueName = process.env.DEPLOYMENT_QUEUE_NAME || 'deployment-jobs';

let queue: Queue | null = null;

export function getDeploymentQueue(): Queue {
    if (!process.env.REDIS_URL) {
        console.warn('[Web] REDIS_URL not set. Using default redis://127.0.0.1:6379/0');
    }

    if (!redisUrl.startsWith('redis')) {
        throw new Error('REDIS_URL must start with redis:// or rediss://');
    }

    const url = new URL(redisUrl);
    const connection = {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: decodeURIComponent(url.username || ''),
        password: decodeURIComponent(url.password || ''),
        db: Number(url.pathname.replace('/', '') || 0),
        tls: url.protocol === 'rediss:' ? {} : undefined,
    };

    if (!queue) {
        queue = new Queue(queueName, { connection });
    }
    return queue;
}

export { queueName };
