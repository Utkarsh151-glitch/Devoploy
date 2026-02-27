create extension if not exists "pgcrypto";

create table if not exists public.deployments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid null,
    original_repo text not null,
    target_cloud text not null,
    idempotency_key text not null unique,
    source_branch text not null default 'main',
    fixed_branch text null,
    fixed_repo_url text null,
    live_deployment_url text null,
    status text not null,
    error_message text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists deployments_status_idx on public.deployments (status);

create table if not exists public.deployment_logs (
    id uuid primary key default gen_random_uuid(),
    deployment_id uuid not null references public.deployments(id) on delete cascade,
    message text not null,
    log_level text not null,
    created_at timestamptz not null default now()
);

create index if not exists deployment_logs_deployment_id_idx
    on public.deployment_logs (deployment_id, created_at);
