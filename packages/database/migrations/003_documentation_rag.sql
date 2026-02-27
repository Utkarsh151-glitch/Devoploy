create extension if not exists vector;

create table if not exists public.documentation_sources (
    id uuid primary key default gen_random_uuid(),
    source text not null,
    title text not null,
    content_hash text not null unique,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.documentation_chunks (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null references public.documentation_sources(id) on delete cascade,
    chunk_index integer not null,
    content text not null,
    token_count integer not null,
    embedding vector(1536) not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique(source_id, chunk_index)
);

create index if not exists documentation_chunks_source_id_idx
    on public.documentation_chunks (source_id);

create function public.match_documentation_chunks(
    query_embedding vector(1536),
    match_count int default 5,
    metadata_filter jsonb default '{}'::jsonb
)
returns table (
    id uuid,
    source_id uuid,
    chunk_index int,
    content text,
    token_count int,
    metadata jsonb,
    similarity float
)
language sql
as $$
    select
        c.id,
        c.source_id,
        c.chunk_index,
        c.content,
        c.token_count,
        c.metadata,
        1 - (c.embedding <=> query_embedding) as similarity
    from public.documentation_chunks c
    where
        metadata_filter = '{}'::jsonb
        or c.metadata @> metadata_filter
    order by c.embedding <=> query_embedding
    limit greatest(match_count, 1);
$$;
