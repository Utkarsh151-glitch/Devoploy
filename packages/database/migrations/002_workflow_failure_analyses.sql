create table if not exists public.workflow_failure_analyses (
    id uuid primary key default gen_random_uuid(),
    installation_id bigint not null,
    repository_owner text not null,
    repository_name text not null,
    workflow_run_id bigint not null unique,
    workflow_name text null,
    head_branch text null,
    head_sha text null,
    html_url text null,
    category text not null,
    confidence double precision not null,
    extracted_error text not null,
    suggested_fix_type text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists workflow_failure_analyses_repo_idx
    on public.workflow_failure_analyses (repository_owner, repository_name);
