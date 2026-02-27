import { createClient } from '@supabase/supabase-js';
import {
    CreateDeploymentInput,
    DocumentationChunk,
    DocumentationChunkInput,
    DocumentationSource,
    Deployment,
    DeploymentJobPayload,
    DeploymentLog,
    DeploymentStatus,
    UpsertDocumentationSourceInput,
    UpsertWorkflowFailureAnalysisInput,
    WorkflowFailureAnalysis,
} from './types';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
export const supabase = createClient(supabaseUrl ?? 'http://localhost:54321', supabaseKey ?? 'invalid');

const DEPLOYMENTS_TABLE = 'deployments';
const DEPLOYMENT_LOGS_TABLE = 'deployment_logs';
const WORKFLOW_FAILURE_ANALYSES_TABLE = 'workflow_failure_analyses';
const DOCUMENTATION_SOURCES_TABLE = 'documentation_sources';
const DOCUMENTATION_CHUNKS_TABLE = 'documentation_chunks';

function assertDatabaseEnv(): void {
    if (!supabaseUrl || !supabaseKey) {
        throw new Error('SUPABASE_URL and SUPABASE_KEY are required.');
    }
}

const ALLOWED_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
    queued: ['cloning', 'failed'],
    cloning: ['analyzing', 'failed'],
    analyzing: ['fixing', 'failed'],
    fixing: ['pushing', 'failed'],
    pushing: ['completed', 'failed'],
    completed: ['deploying', 'deployment_failed', 'failed'],
    deploying: ['deployed', 'deployment_failed', 'failed'],
    deployed: [],
    deployment_failed: [],
    failed: [],
};

function canTransition(current: DeploymentStatus, next: DeploymentStatus): boolean {
    if (current === next) return true;
    return ALLOWED_TRANSITIONS[current].includes(next);
}

export async function createOrGetDeployment(input: CreateDeploymentInput): Promise<Deployment> {
    assertDatabaseEnv();
    const { data: existing, error: existingError } = await supabase
        .from(DEPLOYMENTS_TABLE)
        .select('*')
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle<Deployment>();

    if (existingError) {
        throw new Error(`Failed to lookup deployment: ${existingError.message}`);
    }

    if (existing) {
        return existing;
    }

    const payload = {
        original_repo: input.repoUrl,
        target_cloud: input.targetCloud,
        idempotency_key: input.idempotencyKey,
        source_branch: input.sourceBranch ?? 'main',
        status: 'queued' as DeploymentStatus,
    };

    const { data, error } = await supabase
        .from(DEPLOYMENTS_TABLE)
        .insert(payload)
        .select('*')
        .single<Deployment>();

    if (error) {
        if (error.code === '23505') {
            const { data: conflicted, error: conflictError } = await supabase
                .from(DEPLOYMENTS_TABLE)
                .select('*')
                .eq('idempotency_key', input.idempotencyKey)
                .single<Deployment>();

            if (conflictError || !conflicted) {
                throw new Error(`Failed to resolve idempotent deployment: ${conflictError?.message ?? 'unknown error'}`);
            }
            return conflicted;
        }

        throw new Error(`Failed to create deployment: ${error.message}`);
    }

    if (!data) {
        throw new Error('Failed to create deployment: empty response');
    }

    return data;
}

export async function getDeploymentById(id: string): Promise<Deployment | null> {
    assertDatabaseEnv();
    const { data, error } = await supabase
        .from(DEPLOYMENTS_TABLE)
        .select('*')
        .eq('id', id)
        .maybeSingle<Deployment>();

    if (error) {
        throw new Error(`Failed to fetch deployment ${id}: ${error.message}`);
    }

    return data;
}

export async function getDeploymentByFixedBranch(branch: string): Promise<Deployment | null> {
    assertDatabaseEnv();
    const { data, error } = await supabase
        .from(DEPLOYMENTS_TABLE)
        .select('*')
        .eq('fixed_branch', branch)
        .maybeSingle<Deployment>();

    if (error) {
        throw new Error(`Failed to fetch deployment by fixed branch ${branch}: ${error.message}`);
    }

    return data;
}

export async function updateDeploymentStatus(
    id: string,
    nextStatus: DeploymentStatus,
    extra: Partial<Pick<Deployment, 'fixed_branch' | 'fixed_repo_url' | 'live_deployment_url' | 'error_message'>> = {}
): Promise<Deployment> {
    assertDatabaseEnv();
    const deployment = await getDeploymentById(id);
    if (!deployment) {
        throw new Error(`Deployment ${id} does not exist`);
    }

    if (!canTransition(deployment.status, nextStatus) && deployment.status !== nextStatus) {
        return deployment;
    }

    const updatePayload = {
        status: nextStatus,
        ...extra,
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from(DEPLOYMENTS_TABLE)
        .update(updatePayload)
        .eq('id', id)
        .select('*')
        .single<Deployment>();

    if (error || !data) {
        throw new Error(`Failed to update deployment ${id}: ${error?.message ?? 'unknown error'}`);
    }

    return data;
}

export async function appendDeploymentLog(
    deploymentId: string,
    message: string,
    logLevel: DeploymentLog['log_level'] = 'INFO'
): Promise<void> {
    assertDatabaseEnv();
    const { error } = await supabase.from(DEPLOYMENT_LOGS_TABLE).insert({
        deployment_id: deploymentId,
        message,
        log_level: logLevel,
    });

    if (error) {
        throw new Error(`Failed to append deployment log: ${error.message}`);
    }
}

export function toDeploymentJobPayload(deploymentId: string): DeploymentJobPayload {
    return { deploymentId };
}

export async function upsertWorkflowFailureAnalysis(
    input: UpsertWorkflowFailureAnalysisInput
): Promise<WorkflowFailureAnalysis> {
    assertDatabaseEnv();

    const payload = {
        installation_id: input.installationId,
        repository_owner: input.repositoryOwner,
        repository_name: input.repositoryName,
        workflow_run_id: input.workflowRunId,
        workflow_name: input.workflowName ?? null,
        head_branch: input.headBranch ?? null,
        head_sha: input.headSha ?? null,
        html_url: input.htmlUrl ?? null,
        category: input.category,
        confidence: input.confidence,
        extracted_error: input.extractedError,
        suggested_fix_type: input.suggestedFixType,
    };

    const { data, error } = await supabase
        .from(WORKFLOW_FAILURE_ANALYSES_TABLE)
        .upsert(payload, { onConflict: 'workflow_run_id' })
        .select('*')
        .single<WorkflowFailureAnalysis>();

    if (error || !data) {
        throw new Error(`Failed to upsert workflow analysis: ${error?.message ?? 'unknown error'}`);
    }

    return data;
}

export async function upsertDocumentationSource(
    input: UpsertDocumentationSourceInput
): Promise<DocumentationSource> {
    assertDatabaseEnv();
    const payload = {
        source: input.source,
        title: input.title,
        content_hash: input.contentHash,
        metadata: input.metadata ?? {},
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from(DOCUMENTATION_SOURCES_TABLE)
        .upsert(payload, { onConflict: 'content_hash' })
        .select('*')
        .single<DocumentationSource>();

    if (error || !data) {
        throw new Error(`Failed to upsert documentation source: ${error?.message ?? 'unknown error'}`);
    }
    return data;
}

export async function replaceDocumentationChunks(
    sourceId: string,
    chunks: DocumentationChunkInput[]
): Promise<DocumentationChunk[]> {
    assertDatabaseEnv();
    await supabase
        .from(DOCUMENTATION_CHUNKS_TABLE)
        .delete()
        .eq('source_id', sourceId);

    if (chunks.length === 0) return [];

    const payload = chunks.map((chunk) => ({
        source_id: sourceId,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        token_count: chunk.tokenCount,
        embedding: chunk.embedding,
        metadata: chunk.metadata ?? {},
    }));

    const { data, error } = await supabase
        .from(DOCUMENTATION_CHUNKS_TABLE)
        .insert(payload)
        .select('*');

    if (error || !data) {
        throw new Error(`Failed to insert documentation chunks: ${error?.message ?? 'unknown error'}`);
    }

    return data as DocumentationChunk[];
}

export async function matchDocumentationChunks(
    queryEmbedding: number[],
    matchCount = 5,
    metadataFilter: Record<string, unknown> = {}
): Promise<Array<DocumentationChunk & { similarity: number }>> {
    assertDatabaseEnv();
    const { data, error } = await supabase.rpc('match_documentation_chunks', {
        query_embedding: queryEmbedding,
        match_count: matchCount,
        metadata_filter: metadataFilter,
    });

    if (error) {
        throw new Error(`Failed to retrieve documentation matches: ${error.message}`);
    }

    return (data ?? []) as Array<DocumentationChunk & { similarity: number }>;
}

export * from './types';
