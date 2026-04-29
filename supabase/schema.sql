create extension if not exists pgcrypto;

create table if not exists public.student_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password text not null,
  display_name text not null,
  role text not null default 'Student',
  initials text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.practice_workspaces (
  id uuid primary key default gen_random_uuid(),
  student_account_id uuid not null unique references public.student_accounts(id) on delete cascade,
  title text not null default 'Weekly Mastery Check',
  quiz_count integer not null default 5,
  quizzes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_practice_workspaces_updated_at on public.practice_workspaces;

create trigger set_practice_workspaces_updated_at
before update on public.practice_workspaces
for each row
execute function public.set_updated_at();

alter table public.student_accounts enable row level security;
alter table public.practice_workspaces enable row level security;

drop policy if exists "demo student accounts read write" on public.student_accounts;
create policy "demo student accounts read write"
on public.student_accounts
for all
using (true)
with check (true);

drop policy if exists "demo practice workspaces read write" on public.practice_workspaces;
create policy "demo practice workspaces read write"
on public.practice_workspaces
for all
using (true)
with check (true);

insert into public.student_accounts (username, password, display_name, role, initials)
values ('student', 'review123', 'Alex Rivera', 'Student', 'AR')
on conflict (username) do update
set
  password = excluded.password,
  display_name = excluded.display_name,
  role = excluded.role,
  initials = excluded.initials;

insert into public.practice_workspaces (student_account_id, title, quiz_count, quizzes)
select
  sa.id,
  'Weekly Mastery Check',
  5,
  '[]'::jsonb
from public.student_accounts sa
where sa.username = 'student'
on conflict (student_account_id) do nothing;
