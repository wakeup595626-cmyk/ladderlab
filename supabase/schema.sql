-- 梯形实验室 · 账号云同步表结构
-- 在 Supabase 控制台 → SQL Editor 里整段执行一次即可。
-- 每个登录用户只能读写属于自己的行：RLS 用 auth.uid() 兜住。

create table if not exists public.ladderlab_projects (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  program jsonb not null,
  created_at bigint not null,
  saved_at bigint not null,
  deleted_at bigint,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.ladderlab_projects enable row level security;

drop policy if exists "own rows" on public.ladderlab_projects;
create policy "own rows" on public.ladderlab_projects
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 同步按 saved_at 倒序拉取，给最常见的查询建个索引。
create index if not exists ladderlab_projects_user_saved_idx
  on public.ladderlab_projects (user_id, saved_at desc);
