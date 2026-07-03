-- ============================================================
-- UndosaTech — Immutable hash-chained audit log
-- Run in the Supabase SQL Editor.
-- ============================================================

create table if not exists public.audit_logs (
    id          bigint generated always as identity primary key,
    event_id    uuid        not null unique,
    study_id    text        not null,
    event_type  text        not null,
    data        jsonb       not null default '{}'::jsonb,
    prev_hash   char(64)    not null,
    entry_hash  char(64)    not null unique,
    created_at  timestamptz not null default now()
);

create index if not exists audit_logs_study_idx on public.audit_logs (study_id, created_at);

-- Immutability: block UPDATE and DELETE at the database level.
create or replace function public.audit_logs_block_mutation()
returns trigger language plpgsql as $$
begin
    raise exception 'audit_logs is append-only — % not permitted', tg_op;
end $$;

drop trigger if exists audit_logs_no_update on public.audit_logs;
create trigger audit_logs_no_update
    before update or delete on public.audit_logs
    for each row execute function public.audit_logs_block_mutation();

-- RLS: service role writes; authenticated users may read.
alter table public.audit_logs enable row level security;

drop policy if exists "audit read for authenticated" on public.audit_logs;
create policy "audit read for authenticated"
    on public.audit_logs for select
    to authenticated
    using (true);

revoke update, delete on public.audit_logs from anon, authenticated;
