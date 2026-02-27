export type DeploymentStatus =
    | 'queued'
    | 'cloning'
    | 'analyzing'
    | 'fixing'
    | 'pushing'
    | 'completed'
    | 'deploying'
    | 'deployed'
    | 'deployment_failed'
    | 'failed';

export type CloudProvider = 'Vercel' | 'AWS' | 'Heroku' | 'GCP';

export interface Deployment {
    id: string;
    user_id?: string | null;
    original_repo: string;
    target_cloud: CloudProvider;
    idempotency_key: string;
    source_branch: string;
    fixed_branch?: string | null;
    fixed_repo_url?: string | null;
    live_deployment_url?: string | null;
    status: DeploymentStatus;
    error_message?: string | null;
    created_at: string;
    updated_at: string;
}

export interface DeploymentLog {
    id: string;
    deployment_id: string;
    message: string;
    log_level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
    created_at: string;
}

export interface CreateDeploymentInput {
    repoUrl: string;
    targetCloud: CloudProvider;
    idempotencyKey: string;
    sourceBranch?: string;
}

export interface DeploymentJobPayload {
    deploymentId: string;
}

export interface WorkflowFailureAnalysis {
    id: string;
    installation_id: number;
    repository_owner: string;
    repository_name: string;
    workflow_run_id: number;
    workflow_name?: string | null;
    head_branch?: string | null;
    head_sha?: string | null;
    html_url?: string | null;
    category: string;
    confidence: number;
    extracted_error: string;
    suggested_fix_type: string;
    created_at: string;
    updated_at: string;
}

export interface UpsertWorkflowFailureAnalysisInput {
    installationId: number;
    repositoryOwner: string;
    repositoryName: string;
    workflowRunId: number;
    workflowName?: string;
    headBranch?: string;
    headSha?: string;
    htmlUrl?: string;
    category: string;
    confidence: number;
    extractedError: string;
    suggestedFixType: string;
}

export interface DocumentationSource {
    id: string;
    source: string;
    title: string;
    content_hash: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface DocumentationChunk {
    id: string;
    source_id: string;
    chunk_index: number;
    content: string;
    token_count: number;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface UpsertDocumentationSourceInput {
    source: string;
    title: string;
    contentHash: string;
    metadata?: Record<string, unknown>;
}

export interface DocumentationChunkInput {
    chunkIndex: number;
    content: string;
    tokenCount: number;
    embedding: number[];
    metadata?: Record<string, unknown>;
}
