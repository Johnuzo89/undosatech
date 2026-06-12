-- CODA: REDCap & OMOP data connections table
-- Run this in Supabase SQL Editor

create table if not exists public.data_connections (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  connection_type  text not null check (connection_type in ('redcap', 'omop')),
  name             text not null,
  config           jsonb default '{}',
  status           text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_tested_at   timestamptz,
  created_at       timestamptz default now() not null
);

alter table public.data_connections enable row level security;

-- Users can only see their own connections
create policy "Users manage own connections"
  on public.data_connections
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for fast user lookups
create index if not exists idx_data_connections_user_id on public.data_connections(user_id);
