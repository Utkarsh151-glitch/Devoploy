import { Pool } from 'pg';
import {
    CreateDeploymentInput,
    DocumentationChunk,
    DocumentationChunkInput,
    DocumentationSource,
    Deployment,
    DeploymentListFilters,
    DeploymentListResult,
    DeploymentJobPayload,
    DeploymentLog,
    DeploymentStatus,
    DashboardSummary,
    RecentActivityItem,
    RepositorySummary,
    UpsertDocumentationSourceInput,
    UpsertWorkflowFailureAnalysisInput,
    WorkflowFailureAnalysis,
} from './types';

const ALLOWED_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
    queued: ['cloning', 'failed'],
    cloning: ['analyzing', 'failed'],
    analyzing: ['fixing', 'failed'],
    fixing: ['pushing', 'failed'],
    pushing: ['completed', 'failed'],
    completed: ['deploying', 'deployment_failed', 'failed'],
    deploying: ['deployed', 'deployment_failed', 'failed'],
    deployed: [],
    deployment_failed: ['queued'],
    failed: ['queued'],
};

declare global {
    // eslint-disable-next-line no-var
    var __devoployPgPool: Pool | undefined;
}

function assertDatabaseEnv(): void {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required.');
    }
}

function getPool(): Pool {
    assertDatabaseEnv();

    if (!global.__devoployPgPool) {
        global.__devoployPgPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: Number(process.env.DB_POOL_MAX || 10),
            idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
            connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10_000),
            ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
        });
    }

    return global.__devoployPgPool;
}

export async function checkDatabaseHealth(): Promise<boolean> {
    assertDatabaseEnv();
    const pool = getPool();
    await pool.query('select 1');
    return true;
}

function canTransition(current: DeploymentStatus, next: DeploymentStatus): boolean {
    if (current === next) return true;
    return ALLOWED_TRANSITIONS[current].includes(next);
}

function toVectorLiteral(values: number[]): string {
    if (!Array.isArray(values) || values.length === 0) {
        throw new Error('Embedding vector must be a non-empty array.');
    }
    for (const value of values) {
        if (!Number.isFinite(value)) {
            throw new Error('Embedding vector contains non-finite values.');
        }
    }
    return `[${values.join(',')}]`;
}

export async function createOrGetDeployment(input: CreateDeploymentInput): Promise<Deployment> {
    assertDatabaseEnv();
    const pool = getPool();

    const result = await pool.query<Deployment>(
        `insert into deployments (original_repo, target_cloud, idempotency_key, source_branch, status)
         values ($1, $2, $3, $4, 'queued')
         on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
         returning *`,
        [input.repoUrl, input.targetCloud, input.idempotencyKey, input.sourceBranch ?? 'main']
    );

    if (!result.rows[0]) {
        throw new Error('Failed to create or retrieve deployment.');
    }

    return result.rows[0];
}

export async function getDeploymentById(id: string): Promise<Deployment | null> {
    assertDatabaseEnv();
    const pool = getPool();
    const result = await pool.query<Deployment>('select * from deployments where id = $1 limit 1', [id]);
    return result.rows[0] ?? null;
}

export async function getDeploymentByFixedBranch(branch: string): Promise<Deployment | null> {
    assertDatabaseEnv();
    const pool = getPool();
    const result = await pool.query<Deployment>(
        'select * from deployments where fixed_branch = $1 limit 1',
        [branch]
    );
    return result.rows[0] ?? null;
}

export async function deleteDeploymentById(id: string): Promise<boolean> {
    assertDatabaseEnv();
    const pool = getPool();
    const result = await pool.query<{ id: string }>(
        'delete from deployments where id = $1 returning id',
        [id]
    );
    return Boolean(result.rows[0]?.id);
}

export async function listDeployments(filters: DeploymentListFilters = {}): Promise<DeploymentListResult> {
    assertDatabaseEnv();
    const pool = getPool();
    const page = Math.max(filters.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters.pageSize ?? 20, 1), 100);
    const where: string[] = [];
    const values: unknown[] = [];

    if (filters.status) {
        values.push(filters.status);
        where.push(`status = $${values.length}`);
    }
    if (filters.repo) {
        values.push(`%${filters.repo}%`);
        where.push(`original_repo ilike $${values.length}`);
    }

    const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : '';
    const offset = (page - 1) * pageSize;
    values.push(pageSize, offset);

    const rowsPromise = pool.query<Deployment>(
        `select * from deployments ${whereSql} order by created_at desc limit $${values.length - 1} offset $${values.length}`
        , values
    );

    const countValues = values.slice(0, values.length - 2);
    const countPromise = pool.query<{ total: string }>(
        `select count(*)::text as total from deployments ${whereSql}`,
        countValues
    );

    const [rowsResult, countResult] = await Promise.all([rowsPromise, countPromise]);

    return {
        rows: rowsResult.rows,
        total: Number(countResult.rows[0]?.total ?? 0),
        page,
        pageSize,
    };
}

export async function updateDeploymentStatus(
    id: string,
    nextStatus: DeploymentStatus,
    extra: Partial<Pick<Deployment, 'fixed_branch' | 'fixed_repo_url' | 'live_deployment_url' | 'error_message'>> = {}
): Promise<Deployment> {
    assertDatabaseEnv();
    const current = await getDeploymentById(id);
    if (!current) {
        throw new Error(`Deployment ${id} does not exist`);
    }

    if (!canTransition(current.status, nextStatus) && current.status !== nextStatus) {
        return current;
    }

    const pool = getPool();
    const result = await pool.query<Deployment>(
        `update deployments
         set status = $2,
             fixed_branch = coalesce($3, fixed_branch),
             fixed_repo_url = coalesce($4, fixed_repo_url),
             live_deployment_url = coalesce($5, live_deployment_url),
             error_message = $6,
             updated_at = now()
         where id = $1
         returning *`,
        [
            id,
            nextStatus,
            extra.fixed_branch ?? null,
            extra.fixed_repo_url ?? null,
            extra.live_deployment_url ?? null,
            extra.error_message ?? null,
        ]
    );

    if (!result.rows[0]) {
        throw new Error(`Failed to update deployment ${id}`);
    }

    return result.rows[0];
}

export async function appendDeploymentLog(
    deploymentId: string,
    message: string,
    logLevel: DeploymentLog['log_level'] = 'INFO'
): Promise<void> {
    assertDatabaseEnv();
    const pool = getPool();
    await pool.query(
        'insert into deployment_logs (deployment_id, message, log_level) values ($1, $2, $3)',
        [deploymentId, message, logLevel]
    );
}

export async function getDeploymentLogs(deploymentId: string): Promise<DeploymentLog[]> {
    assertDatabaseEnv();
    const pool = getPool();
    const result = await pool.query<DeploymentLog>(
        'select * from deployment_logs where deployment_id = $1 order by created_at asc',
        [deploymentId]
    );
    return result.rows;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
    assertDatabaseEnv();
    const pool = getPool();
    const result = await pool.query<{
        total_deployments: string;
        successful_deployments: string;
        failed_ci_runs: string;
        fix_successful: string;
        fix_total: string;
    }>(
        `select
            count(*)::text as total_deployments,
            count(*) filter (where status in ('completed', 'deployed'))::text as successful_deployments,
            count(*) filter (where status in ('failed', 'deployment_failed'))::text as failed_ci_runs,
            count(*) filter (where fixed_branch is not null and status in ('completed', 'deployed'))::text as fix_successful,
            count(*) filter (where fixed_branch is not null)::text as fix_total
         from deployments`
    );
    const row = result.rows[0];
    const total = Number(row?.total_deployments ?? 0);
    const successful = Number(row?.successful_deployments ?? 0);
    const failedCiRuns = Number(row?.failed_ci_runs ?? 0);
    const fixSuccessful = Number(row?.fix_successful ?? 0);
    const fixTotal = Number(row?.fix_total ?? 0);

    return {
        totalDeployments: total,
        successRate: total > 0 ? (successful / total) * 100 : 0,
        failedCiRuns,
        fixSuccessPercentage: fixTotal > 0 ? (fixSuccessful / fixTotal) * 100 : 0,
    };
}

export async function listRecentActivity(limit = 20): Promise<RecentActivityItem[]> {
    assertDatabaseEnv();
    const pool = getPool();
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const result = await pool.query<RecentActivityItem>(
        `select
            l.id,
            l.deployment_id,
            d.original_repo,
            d.status,
            l.message,
            l.log_level,
            l.created_at
         from deployment_logs l
         join deployments d on d.id = l.deployment_id
         order by l.created_at desc
         limit $1`,
        [safeLimit]
    );
    return result.rows;
}

export async function listRepositorySummaries(limit = 100): Promise<RepositorySummary[]> {
    assertDatabaseEnv();
    const pool = getPool();
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const result = await pool.query<RepositorySummary>(
        `select
            d.original_repo as repo,
            d.id as "lastDeploymentId",
            d.status as "lastStatus",
            d.updated_at as "lastUpdatedAt",
            agg.total as "totalDeployments"
         from deployments d
         join (
            select original_repo, count(*)::int as total, max(created_at) as max_created
            from deployments
            group by original_repo
         ) agg on agg.original_repo = d.original_repo and agg.max_created = d.created_at
         order by d.updated_at desc
         limit $1`,
        [safeLimit]
    );
    return result.rows;
}

export async function getLatestWorkflowAnalysisForRepo(
    repositoryOwner: string,
    repositoryName: string
): Promise<WorkflowFailureAnalysis | null> {
    assertDatabaseEnv();
    const pool = getPool();
    const result = await pool.query<WorkflowFailureAnalysis>(
        `select * from workflow_failure_analyses
         where repository_owner = $1 and repository_name = $2
         order by created_at desc
         limit 1`,
        [repositoryOwner, repositoryName]
    );
    return result.rows[0] ?? null;
}

export async function listDocumentationSources(limit = 100): Promise<Array<DocumentationSource & { chunk_count: number }>> {
    assertDatabaseEnv();
    const pool = getPool();
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const result = await pool.query<Array<DocumentationSource & { chunk_count: number }>[0]>(
        `select
            s.*,
            count(c.id)::int as chunk_count
         from documentation_sources s
         left join documentation_chunks c on c.source_id = s.id
         group by s.id
         order by s.updated_at desc
         limit $1`,
        [safeLimit]
    );
    return result.rows;
}

export function toDeploymentJobPayload(deploymentId: string): DeploymentJobPayload {
    return { deploymentId };
}

export async function upsertWorkflowFailureAnalysis(
    input: UpsertWorkflowFailureAnalysisInput
): Promise<WorkflowFailureAnalysis> {
    assertDatabaseEnv();
    const pool = getPool();

    const result = await pool.query<WorkflowFailureAnalysis>(
        `insert into workflow_failure_analyses (
            installation_id,
            repository_owner,
            repository_name,
            workflow_run_id,
            workflow_name,
            head_branch,
            head_sha,
            html_url,
            category,
            confidence,
            extracted_error,
            original_log_snippet,
            suggested_fix_type,
            rule_matched,
            why_this_fix
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        on conflict (workflow_run_id) do update set
            installation_id = excluded.installation_id,
            repository_owner = excluded.repository_owner,
            repository_name = excluded.repository_name,
            workflow_name = excluded.workflow_name,
            head_branch = excluded.head_branch,
            head_sha = excluded.head_sha,
            html_url = excluded.html_url,
            category = excluded.category,
            confidence = excluded.confidence,
            extracted_error = excluded.extracted_error,
            original_log_snippet = excluded.original_log_snippet,
            suggested_fix_type = excluded.suggested_fix_type,
            rule_matched = excluded.rule_matched,
            why_this_fix = excluded.why_this_fix,
            updated_at = now()
        returning *`,
        [
            input.installationId,
            input.repositoryOwner,
            input.repositoryName,
            input.workflowRunId,
            input.workflowName ?? null,
            input.headBranch ?? null,
            input.headSha ?? null,
            input.htmlUrl ?? null,
            input.category,
            input.confidence,
            input.extractedError,
            input.originalLogSnippet,
            input.suggestedFixType,
            input.ruleMatched,
            input.whyThisFix,
        ]
    );

    if (!result.rows[0]) {
        throw new Error('Failed to upsert workflow analysis.');
    }

    return result.rows[0];
}

export async function upsertDocumentationSource(
    input: UpsertDocumentationSourceInput
): Promise<DocumentationSource> {
    assertDatabaseEnv();
    const pool = getPool();
    const result = await pool.query<DocumentationSource>(
        `insert into documentation_sources (source, title, content_hash, metadata)
         values ($1, $2, $3, $4::jsonb)
         on conflict (content_hash) do update set
            source = excluded.source,
            title = excluded.title,
            metadata = excluded.metadata,
            updated_at = now()
         returning *`,
        [input.source, input.title, input.contentHash, JSON.stringify(input.metadata ?? {})]
    );

    if (!result.rows[0]) {
        throw new Error('Failed to upsert documentation source.');
    }

    return result.rows[0];
}

export async function replaceDocumentationChunks(
    sourceId: string,
    chunks: DocumentationChunkInput[]
): Promise<DocumentationChunk[]> {
    assertDatabaseEnv();
    const pool = getPool();
    const client = await pool.connect();

    try {
        await client.query('begin');
        await client.query('delete from documentation_chunks where source_id = $1', [sourceId]);

        if (chunks.length === 0) {
            await client.query('commit');
            return [];
        }

        const values: unknown[] = [];
        const rowSql = chunks.map((chunk, i) => {
            const base = i * 6;
            values.push(
                sourceId,
                chunk.chunkIndex,
                chunk.content,
                chunk.tokenCount,
                toVectorLiteral(chunk.embedding),
                JSON.stringify(chunk.metadata ?? {})
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector, $${base + 6}::jsonb)`;
        });

        const inserted = await client.query<DocumentationChunk>(
            `insert into documentation_chunks (source_id, chunk_index, content, token_count, embedding, metadata)
             values ${rowSql.join(', ')}
             returning id, source_id, chunk_index, content, token_count, metadata, created_at`,
            values
        );

        await client.query('commit');
        return inserted.rows;
    } catch (error) {
        await client.query('rollback');
        throw error;
    } finally {
        client.release();
    }
}

export async function matchDocumentationChunks(
    queryEmbedding: number[],
    matchCount = 5,
    metadataFilter: Record<string, unknown> = {}
): Promise<Array<DocumentationChunk & { similarity: number }>> {
    assertDatabaseEnv();
    const pool = getPool();
    const result = await pool.query<DocumentationChunk & { similarity: number }>(
        `select
            id,
            source_id,
            chunk_index,
            content,
            token_count,
            metadata,
            created_at,
            1 - (embedding <=> $1::vector) as similarity
         from documentation_chunks
         where $3::jsonb = '{}'::jsonb or metadata @> $3::jsonb
         order by embedding <=> $1::vector
         limit greatest($2::int, 1)`,
        [toVectorLiteral(queryEmbedding), matchCount, JSON.stringify(metadataFilter)]
    );

    return result.rows;
}

export * from './types';
