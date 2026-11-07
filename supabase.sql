-- Chạy 1 lần trong Supabase → SQL Editor (bao gồm cả phần liên kết TV)

create table if not exists profiles (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table profiles enable row level security;
drop policy if exists "chi chu tai khoan" on profiles;
create policy "chi chu tai khoan" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===== Liên kết TV bằng mã =====
create table if not exists tv_pending (
  code text primary key,
  secret_hash text not null,
  user_id uuid,
  uname text,
  created_at timestamptz default now()
);
create table if not exists tv_links (
  secret_hash text primary key,
  user_id uuid not null references auth.users on delete cascade,
  uname text not null,
  created_at timestamptz default now()
);
alter table tv_pending enable row level security;
alter table tv_links enable row level security;
-- Không tạo policy: chỉ các hàm bên dưới mới đọc/ghi được 2 bảng này.

create or replace function tv_start(p_code text, p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(p_code) <> 6 or length(p_secret) < 32 then raise exception 'bad request'; end if;
  delete from tv_pending where created_at < now() - interval '15 minutes';
  insert into tv_pending(code, secret_hash)
  values (upper(p_code), encode(sha256(convert_to(p_secret, 'utf8')), 'hex'));
end $$;

create or replace function tv_approve(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_name text;
begin
  if v_uid is null then raise exception 'login required'; end if;
  select split_part(email, '@', 1) into v_name from auth.users where id = v_uid;
  update tv_pending set user_id = v_uid, uname = v_name
   where code = upper(p_code) and user_id is null
     and created_at > now() - interval '10 minutes';
  return found;
end $$;

create or replace function tv_poll(p_code text, p_secret text) returns text
language plpgsql security definer set search_path = public as $$
declare r tv_pending; h text := encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
begin
  select * into r from tv_pending
   where code = upper(p_code) and secret_hash = h and user_id is not null;
  if not found then return null; end if;
  insert into tv_links(secret_hash, user_id, uname) values (h, r.user_id, r.uname)
  on conflict (secret_hash) do update set user_id = excluded.user_id, uname = excluded.uname;
  delete from tv_pending where code = r.code;
  return r.uname;
end $$;

create or replace function tv_pull(p_secret text) returns jsonb
language sql security definer set search_path = public as $$
  select p.data from tv_links l join profiles p on p.user_id = l.user_id
  where l.secret_hash = encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
$$;

create or replace function tv_push(p_secret text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  select user_id into v_uid from tv_links
   where secret_hash = encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
  if v_uid is null then raise exception 'not linked'; end if;
  insert into profiles(user_id, data, updated_at) values (v_uid, p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
end $$;

create or replace function tv_unlink(p_secret text) returns void
language sql security definer set search_path = public as $$
  delete from tv_links where secret_hash = encode(sha256(convert_to(p_secret, 'utf8')), 'hex');
$$;

revoke execute on function tv_approve(text) from public, anon;
grant execute on function tv_approve(text) to authenticated;
grant execute on function tv_start(text, text), tv_poll(text, text), tv_pull(text),
  tv_push(text, jsonb), tv_unlink(text) to anon, authenticated;
