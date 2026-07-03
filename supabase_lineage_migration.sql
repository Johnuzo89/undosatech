-- ============================================================
-- UndosaTech — Lineage / provenance events
-- Dataset → study → output derivation chain.
-- Run in the Supabase SQL Editor.
-- ============================================================

create table if not exists public.lineage_events (
    id          bigint generated always as identity primary key,
    entity_type text        not null,
    entity_id   text        not null,
    parent_type text,
    parent_id   text,
    action      text        not null,
    actor       text        not null default '',
    metadata    jsonb       not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists lineage_entity_idx on public.lineage_events (entity_type, entity_id);
create index if not exists lineage_parent_idx on public.lineage_events (parent_type, parent_id);

alter table public.lineage_events enable row level security;

drop policy if exists "lineage read for authenticated" on public.lineage_events;
create policy "lineage read for authenticated"
    on public.lineage_events for select
    to authenticated
    using (true);

revoke update, delete on public.lineage_events from anon, authenticated;
