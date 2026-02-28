alter table public.workflow_failure_analyses
    add column if not exists original_log_snippet text not null default '',
    add column if not exists rule_matched text not null default '',
    add column if not exists why_this_fix text not null default '';
