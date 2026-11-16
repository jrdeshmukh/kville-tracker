-- K-Ville Tracker schema. Paste into Supabase → SQL Editor → Run.
-- Safe to re-run: it drops and recreates the app's objects in the public schema.

-- ============================================================ tables

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Tenter',
  venmo text,
  avatar_url text,
  calendar_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  settings jsonb not null,
  created_by uuid not null references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  submitted_at timestamptz,
  primary key (group_id, user_id)
);

create table if not exists public.availability (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  start timestamptz not null,
  "end" timestamptz not null,
  kind text not null check (kind in ('unavailable','prefer_not')),
  check ("end" > start)
);
create index if not exists availability_group_idx on public.availability(group_id);

create table if not exists public.special_periods (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  start timestamptz not null,
  "end" timestamptz not null,
  kind text not null check (kind in ('grace','harsh')),
  note text,
  check ("end" > start)
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  start timestamptz not null,
  "end" timestamptz not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_night boolean not null default false,
  weight numeric not null default 0,
  source text not null default 'auto' check (source in ('auto','manual','swap')),
  checked_in_at timestamptz,
  reminded_at timestamptz,
  check ("end" > start)
);
create index if not exists shifts_group_start_idx on public.shifts(group_id, start);

create table if not exists public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now()
);

alter table public.swap_requests add column if not exists start timestamptz;
alter table public.swap_requests add column if not exists "end" timestamptz;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  total_cents integer not null check (total_cents >= 0),
  buyer_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.expense_shares (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  paid_at timestamptz,
  primary key (expense_id, user_id)
);

create table if not exists public.gear_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  assignee_id uuid references public.profiles(id) on delete set null,
  done boolean not null default false
);

create table if not exists public.buddies (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  buddy_id uuid not null references public.profiles(id) on delete cascade,
  primary key (group_id, user_id, buddy_id)
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

-- ============================================================ helpers

create or replace function public.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

create or replace function public.is_admin(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.shares_group(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select other = auth.uid() or exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other);
$$;

-- new auth user → profile
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, avatar_url)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Tenter'),
          new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================ RPCs

create or replace function public.create_group(p_name text, p_settings jsonb) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups; code text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  loop
    code := upper(substr(translate(md5(random()::text || clock_timestamp()::text), '01', ''), 1, 6));
    exit when length(code) = 6 and not exists (select 1 from groups where invite_code = code);
  end loop;
  insert into groups (name, invite_code, settings, created_by)
  values (p_name, code, p_settings, auth.uid()) returning * into g;
  insert into group_members (group_id, user_id, role) values (g.id, auth.uid(), 'admin');
  return g;
end $$;

create or replace function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g groups; cnt int; maxm int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into g from groups where invite_code = upper(trim(p_code));
  if g.id is null then raise exception 'No group with that code'; end if;
  if exists (select 1 from group_members where group_id = g.id and user_id = auth.uid()) then
    return g.id;
  end if;
  select count(*) into cnt from group_members where group_id = g.id;
  maxm := nullif(g.settings->>'maxMembers', '')::int;
  if maxm is not null and cnt >= maxm then
    raise exception 'This group is full (% max)', maxm;
  end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return g.id;
end $$;

-- Replace all of a user's availability in one go (my-times editor saves the whole thing).
create or replace function public.replace_my_availability(p_group uuid, p_ranges jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_group) then raise exception 'not a member'; end if;
  delete from availability where group_id = p_group and user_id = auth.uid();
  insert into availability (group_id, user_id, start, "end", kind)
  select p_group, auth.uid(), (r->>'start')::timestamptz, (r->>'end')::timestamptz, r->>'kind'
  from jsonb_array_elements(p_ranges) r;
end $$;

-- Admin: swap in a freshly generated future schedule. Past/in-progress, manual and swapped shifts are kept.
create or replace function public.replace_future_shifts(p_group uuid, p_from timestamptz, p_shifts jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_group) then raise exception 'admins only'; end if;
  delete from shifts where group_id = p_group and start >= p_from and source = 'auto';
  insert into shifts (group_id, start, "end", user_id, is_night, weight, source)
  select p_group, (s->>'start')::timestamptz, (s->>'end')::timestamptz, (s->>'user_id')::uuid,
         coalesce((s->>'is_night')::boolean, false), coalesce((s->>'weight')::numeric, 0),
         coalesce(s->>'source', 'auto')
  from jsonb_array_elements(p_shifts) s;
end $$;

create or replace function public.check_in(p_shift uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update shifts set checked_in_at = now() where id = p_shift and user_id = auth.uid();
end $$;

-- Give [p_start, p_end) of a shift to p_to (null range = whole shift). The rest stays with the
-- original person, split into before/after pieces. Weight is split by duration.
create or replace function public._hand_over(p_shift uuid, p_to uuid, p_start timestamptz, p_end timestamptz, p_source text) returns void
language plpgsql security definer set search_path = public as $$
declare s shifts; a timestamptz; b timestamptz; per numeric;
begin
  select * into s from shifts where id = p_shift for update;
  if s.id is null then raise exception 'shift not found'; end if;
  a := greatest(coalesce(p_start, s.start), s.start);
  b := least(coalesce(p_end, s."end"), s."end");
  if b <= a then raise exception 'That time isn''t part of the shift'; end if;
  if a = s.start and b = s."end" then
    update shifts set user_id = p_to, source = p_source, checked_in_at = null where id = s.id;
    return;
  end if;
  per := s.weight / extract(epoch from (s."end" - s.start));
  insert into shifts (group_id, start, "end", user_id, is_night, weight, source)
    values (s.group_id, a, b, p_to, s.is_night, round(per * extract(epoch from (b - a)), 2), p_source);
  if a > s.start then
    update shifts set "end" = a, weight = round(per * extract(epoch from (a - s.start)), 2) where id = s.id;
    if b < s."end" then
      insert into shifts (group_id, start, "end", user_id, is_night, weight, source)
        values (s.group_id, b, s."end", s.user_id, s.is_night, round(per * extract(epoch from (s."end" - b)), 2), s.source);
    end if;
  else
    update shifts set start = b, weight = round(per * extract(epoch from (s."end" - b)), 2) where id = s.id;
  end if;
end $$;
revoke execute on function public._hand_over(uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;

create or replace function public.reassign_part(p_shift uuid, p_user uuid, p_start timestamptz, p_end timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  select group_id into g from shifts where id = p_shift;
  if g is null or not is_admin(g) then raise exception 'admins only'; end if;
  if not exists (select 1 from group_members where group_id = g and user_id = p_user) then raise exception 'not a member'; end if;
  perform _hand_over(p_shift, p_user, p_start, p_end, 'manual');
end $$;

create or replace function public.respond_swap(p_swap uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r swap_requests;
begin
  select * into r from swap_requests where id = p_swap and status = 'pending';
  if r.id is null then raise exception 'request is no longer open'; end if;
  if r.to_user <> auth.uid() then raise exception 'not your request'; end if;
  if p_accept then
    if not exists (select 1 from shifts where id = r.shift_id and user_id = r.from_user) then
      raise exception 'shift already changed';
    end if;
    perform _hand_over(r.shift_id, r.to_user, r.start, r."end", 'swap');
    update swap_requests set status = 'accepted' where id = r.id;
    update swap_requests set status = 'cancelled' where shift_id = r.shift_id and status = 'pending' and id <> r.id;
  else
    update swap_requests set status = 'declined' where id = r.id;
  end if;
end $$;

create or replace function public.mark_submitted(p_group uuid, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update group_members set submitted_at = case when p_done then now() else null end
  where group_id = p_group and user_id = auth.uid();
end $$;

create or replace function public.create_expense(p_group uuid, p_title text, p_total int, p_buyer uuid, p_shares jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  if not is_admin(p_group) then raise exception 'admins only'; end if;
  insert into expenses (group_id, title, total_cents, buyer_id) values (p_group, p_title, p_total, p_buyer) returning id into eid;
  insert into expense_shares (expense_id, user_id, amount_cents, paid_at)
  select eid, (s->>'user_id')::uuid, (s->>'amount_cents')::int,
         case when (s->>'user_id')::uuid = p_buyer then now() else null end
  from jsonb_array_elements(p_shares) s;
  return eid;
end $$;

-- ============================================================ RLS

alter table profiles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table availability enable row level security;
alter table special_periods enable row level security;
alter table shifts enable row level security;
alter table swap_requests enable row level security;
alter table expenses enable row level security;
alter table expense_shares enable row level security;
alter table gear_items enable row level security;
alter table buddies enable row level security;
alter table alerts enable row level security;
alter table push_subscriptions enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy profiles_read on profiles for select using (shares_group(id));
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy groups_read on groups for select using (is_member(id));
create policy groups_update on groups for update using (is_admin(id)) with check (is_admin(id));
create policy groups_delete on groups for delete using (is_admin(id));

create policy members_read on group_members for select using (is_member(group_id));
create policy members_update on group_members for update using (is_admin(group_id)) with check (is_admin(group_id));
create policy members_delete on group_members for delete using (is_admin(group_id) or user_id = auth.uid());

create policy avail_read on availability for select using (is_member(group_id));
create policy avail_write on availability for all
  using (user_id = auth.uid() or is_admin(group_id))
  with check (is_member(group_id) and (user_id = auth.uid() or is_admin(group_id)));

create policy special_read on special_periods for select using (is_member(group_id));
create policy special_write on special_periods for all using (is_admin(group_id)) with check (is_admin(group_id));

create policy shifts_read on shifts for select using (is_member(group_id));
create policy shifts_write on shifts for all using (is_admin(group_id)) with check (is_admin(group_id));

create policy swaps_read on swap_requests for select using (is_member(group_id));
create policy swaps_insert on swap_requests for insert
  with check (is_member(group_id) and (from_user = auth.uid() or is_admin(group_id)));
create policy swaps_update on swap_requests for update
  using (from_user = auth.uid() or is_admin(group_id));

create policy expenses_read on expenses for select using (is_member(group_id));
create policy expenses_admin on expenses for all using (is_admin(group_id)) with check (is_admin(group_id));

create policy shares_read on expense_shares for select
  using (exists (select 1 from expenses e where e.id = expense_id and is_member(e.group_id)));
create policy shares_update on expense_shares for update
  using (exists (select 1 from expenses e where e.id = expense_id and (e.buyer_id = auth.uid() or is_admin(e.group_id))));
create policy shares_admin on expense_shares for all
  using (exists (select 1 from expenses e where e.id = expense_id and is_admin(e.group_id)))
  with check (exists (select 1 from expenses e where e.id = expense_id and is_admin(e.group_id)));

create policy gear_all on gear_items for all using (is_member(group_id)) with check (is_member(group_id));

create policy buddies_read on buddies for select using (is_member(group_id));
create policy buddies_write on buddies for all using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(group_id));

create policy alerts_read on alerts for select using (is_member(group_id));
create policy alerts_insert on alerts for insert with check (is_member(group_id) and created_by = auth.uid());

create policy push_own on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================ realtime

do $$
declare t text;
begin
  foreach t in array array['groups','group_members','availability','special_periods','shifts','swap_requests','expenses','expense_shares','gear_items','buddies','alerts'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then null;
    end;
  end loop;
end $$;
