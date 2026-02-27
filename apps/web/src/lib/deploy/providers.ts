export type DeploymentProviderName = 'vercel' | 'render' | 'aws-ecs';

export interface DeploymentTriggerInput {
    gitRepository: string;
    gitBranch: string;
    commitSha?: string;
}

export interface DeploymentTriggerResult {
    providerDeploymentId: string;
    providerUrl?: string;
    raw: unknown;
}

export interface DeploymentPollResult {
    state: 'building' | 'ready' | 'error' | 'canceled';
    providerUrl?: string;
    raw: unknown;
}

export interface DeploymentProvider {
    trigger(input: DeploymentTriggerInput): Promise<DeploymentTriggerResult>;
    poll(deploymentId: string): Promise<DeploymentPollResult>;
}

function required(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

class VercelProvider implements DeploymentProvider {
    private token = required('VERCEL_API_TOKEN');
    private projectId = required('VERCEL_PROJECT_ID');
    private teamId = process.env.VERCEL_TEAM_ID;

    private baseHeaders() {
        return {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
        };
    }

    async trigger(input: DeploymentTriggerInput): Promise<DeploymentTriggerResult> {
        const url = new URL('https://api.vercel.com/v13/deployments');
        if (this.teamId) {
            url.searchParams.set('teamId', this.teamId);
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: this.baseHeaders(),
            body: JSON.stringify({
                name: this.projectId,
                project: this.projectId,
                gitSource: {
                    type: 'github',
                    repo: input.gitRepository,
                    ref: input.gitBranch,
                    sha: input.commitSha,
                },
            }),
        });

        const payload = await response.json();
        if (!response.ok) {
            throw new Error(`Vercel deployment trigger failed: ${JSON.stringify(payload)}`);
        }

        return {
            providerDeploymentId: payload.id,
            providerUrl: payload.url ? `https://${payload.url}` : undefined,
            raw: payload,
        };
    }

    async poll(deploymentId: string): Promise<DeploymentPollResult> {
        const url = new URL(`https://api.vercel.com/v13/deployments/${deploymentId}`);
        if (this.teamId) {
            url.searchParams.set('teamId', this.teamId);
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: this.baseHeaders(),
        });
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(`Vercel deployment status failed: ${JSON.stringify(payload)}`);
        }

        const readyState: string = String(payload.readyState || payload.state || '').toUpperCase();
        let state: DeploymentPollResult['state'] = 'building';
        if (readyState === 'READY') state = 'ready';
        if (readyState === 'ERROR') state = 'error';
        if (readyState === 'CANCELED') state = 'canceled';

        return {
            state,
            providerUrl: payload.url ? `https://${payload.url}` : undefined,
            raw: payload,
        };
    }
}

class FutureProviderStub implements DeploymentProvider {
    constructor(private readonly name: string) { }

    async trigger(): Promise<DeploymentTriggerResult> {
        throw new Error(`${this.name} provider is not implemented yet.`);
    }

    async poll(): Promise<DeploymentPollResult> {
        throw new Error(`${this.name} provider is not implemented yet.`);
    }
}

export function getDeploymentProvider(provider: DeploymentProviderName): DeploymentProvider {
    if (provider === 'vercel') return new VercelProvider();
    if (provider === 'render') return new FutureProviderStub('Render');
    return new FutureProviderStub('AWS ECS');
}

export async function waitForDeployment(
    provider: DeploymentProvider,
    deploymentId: string,
    options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<DeploymentPollResult> {
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    const intervalMs = options.intervalMs ?? 10 * 1000;
    const started = Date.now();

    while (true) {
        const status = await provider.poll(deploymentId);
        if (status.state === 'ready' || status.state === 'error' || status.state === 'canceled') {
            return status;
        }
        if (Date.now() - started > timeoutMs) {
            throw new Error('Deployment polling timed out.');
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}
