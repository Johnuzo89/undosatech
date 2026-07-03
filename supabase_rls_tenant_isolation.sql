-- ============================================================
-- UndosaTech — Tenant isolation (institution-scoped RLS)
-- Run in the Supabase SQL Editor AFTER the earlier migrations.
--
-- Model: every user belongs to an institution (derived from
-- their verified email domain, or an explicit user_profiles
-- row). RLS confines direct client reads/writes to rows owned
-- by the user or their institution. The backend service key
-- bypasses RLS as before.
-- ============================================================

-- ── Institution registry ──────────────────────────────────────
create table if not exists public.institutions (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    domain     text not null unique,          -- e.g. dundee.ac.uk
    country    text default 'United Kingdom',
    created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
    user_id            uuid primary key references auth.users(id) on delete cascade,
    institution_id     uuid references public.institutions(id),
    institution_domain text,                  -- denormalised for fast policy checks
    role               text not null default 'researcher'
                       check (role in ('researcher', 'data_custodian', 'admin')),
    created_at         timestamptz not null default now()
);

-- Auto-create a profile on signup, deriving domain from the email
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.user_profiles (user_id, institution_domain)
    values (new.id, lower(split_part(new.email, '@', 2)))
    on conflict (user_id) do nothing;
    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Backfill profiles for existing users
insert into public.user_profiles (user_id, institution_domain)
select id, lower(split_part(email, '@', 2)) from auth.users
on conflict (user_id) do nothing;

-- ── Policy helper: the caller's institution domain ────────────
create or replace function public.my_institution_domain()
returns text language sql stable security definer set search_path = public as $$
    select coalesce(
        (select institution_domain from public.user_profiles where user_id = auth.uid()),
        lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 2))
    )
$$;

alter table public.institutions  enable row level security;
alter table public.user_profiles enable row level security;

drop policy if exists "institutions readable" on public.institutions;
create policy "institutions readable"
    on public.institutions for select to authenticated using (true);

drop policy if exists "own profile readable" on public.user_profiles;
create policy "own profile readable"
    on public.user_profiles for select to authenticated
    using (user_id = auth.uid());

-- ── study_invitations: create if missing ──────────────────────
-- (Backend inserts into this table on study launch; some environments
-- never ran the section of supabase_schema.sql that defines it.)
create table if not exists public.study_invitations (
    id                bigserial primary key,
    study_id          text not null,
    node_id           text not null,
    invited_by        text not null,
    invited_by_email  text,
    study_name        text,
    message           text,
    status            text not null default 'pending'
                      check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
    responded_at      timestamptz,
    decline_reason    text,
    invited_at        timestamptz not null default now(),
    unique(study_id, node_id)
);
create index if not exists idx_study_invitations_study  on public.study_invitations(study_id);
create index if not exists idx_study_invitations_node   on public.study_invitations(node_id);
create index if not exists idx_study_invitations_status on public.study_invitations(status);

-- ── Table-scoped policies ──────────────────────────────────────
-- Each section is guarded with to_regclass() so the migration
-- succeeds even on environments missing some optional tables.

-- studies: owner or same institution
do $$ begin
if to_regclass('public.studies') is not null then
    execute 'alter table public.studies enable row level security';
    execute 'drop policy if exists "studies visible to owner or institution" on public.studies';
    execute $p$create policy "studies visible to owner or institution"
        on public.studies for select to authenticated
        using (
            user_id = auth.uid()
            or lower(split_part(coalesce(user_email, ''), '@', 2)) = public.my_institution_domain()
        )$p$;
end if; end $$;

-- study_logs / study_rounds: follow parent study visibility
do $$ begin
if to_regclass('public.study_logs') is not null then
    execute 'alter table public.study_logs enable row level security';
    execute 'drop policy if exists "logs follow study visibility" on public.study_logs';
    execute $p$create policy "logs follow study visibility"
        on public.study_logs for select to authenticated
        using (exists (
            select 1 from public.studies s
            where s.id = study_logs.study_id
              and (s.user_id = auth.uid()
                   or lower(split_part(coalesce(s.user_email, ''), '@', 2)) = public.my_institution_domain())
        ))$p$;
end if; end $$;

do $$ begin
if to_regclass('public.study_rounds') is not null then
    execute 'alter table public.study_rounds enable row level security';
    execute 'drop policy if exists "rounds follow study visibility" on public.study_rounds';
    execute $p$create policy "rounds follow study visibility"
        on public.study_rounds for select to authenticated
        using (exists (
            select 1 from public.studies s
            where s.id = study_rounds.study_id
              and (s.user_id = auth.uid()
                   or lower(split_part(coalesce(s.user_email, ''), '@', 2)) = public.my_institution_domain())
        ))$p$;
end if; end $$;

-- fl_node_heartbeats: own institution's nodes only
do $$ begin
if to_regclass('public.fl_node_heartbeats') is not null
   and to_regclass('public.fl_nodes') is not null then
    execute 'alter table public.fl_node_heartbeats enable row level security';
    execute 'drop policy if exists "heartbeats scoped to institution" on public.fl_node_heartbeats';
    execute $p$create policy "heartbeats scoped to institution"
        on public.fl_node_heartbeats for select to authenticated
        using (exists (
            select 1 from public.fl_nodes n
            where n.node_id = fl_node_heartbeats.node_id
              and lower(n.institution_domain) = public.my_institution_domain()
        ))$p$;
end if; end $$;

-- study_invitations: inviter or invited institution
do $$ begin
if to_regclass('public.fl_nodes') is not null then
    execute 'alter table public.study_invitations enable row level security';
    execute 'drop policy if exists "invitations visible to parties" on public.study_invitations';
    execute $p$create policy "invitations visible to parties"
        on public.study_invitations for select to authenticated
        using (
            invited_by = auth.uid()::text
            or exists (
                select 1 from public.fl_nodes n
                where n.node_id = study_invitations.node_id
                  and lower(n.institution_domain) = public.my_institution_domain()
            )
        )$p$;
end if; end $$;

-- access_requests: submitters may check their own status
do $$ begin
if to_regclass('public.access_requests') is not null then
    execute 'drop policy if exists "own access request readable" on public.access_requests';
    execute $p$create policy "own access request readable"
        on public.access_requests for select to authenticated
        using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))$p$;
end if; end $$;

-- cohorts: published are public; drafts visible to owner org
do $$ begin
if to_regclass('public.cohorts') is not null then
    execute 'alter table public.cohorts enable row level security';
    execute 'drop policy if exists "published cohorts readable" on public.cohorts';
    execute $p$create policy "published cohorts readable"
        on public.cohorts for select to authenticated
        using (
            status = 'published'
            or lower(split_part(coalesce(contributing_institution, ''), '@', 2)) = public.my_institution_domain()
        )$p$;
end if; end $$;
