-- 在 Supabase Dashboard > SQL Editor 中执行一次。
create table if not exists public.zhitu_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.zhitu_state enable row level security;

-- 业务状态只允许 Cloudflare Function 使用 service_role 访问。
revoke all on table public.zhitu_state from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 4194304)
on conflict (id) do update set public = false, file_size_limit = 4194304;

-- 附件同样只经服务端权限判断后读取，不创建公开 Storage policy。
