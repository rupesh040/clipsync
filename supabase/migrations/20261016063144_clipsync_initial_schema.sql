create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create table public.devices (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 name text not null check (length(name) between 1 and 60),
 platform text not null check (length(platform) between 1 and 60),
 last_seen timestamptz not null default now(),
 last_sync timestamptz,
 revoked boolean not null default true
);
create table public.pairings (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 code_hash text not null unique,
 initiator uuid not null references public.devices(id) on delete cascade,
 participant uuid references public.devices(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '5 minutes',
 consumed boolean not null default false
);
create table public.clips (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 device_id uuid not null references public.devices(id) on delete cascade,
 content text not null check (length(content) between 1 and 20000),
 source text not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 pinned boolean not null default false,
 acknowledged_at timestamptz
);
create index clips_account_date on public.clips(user_id, created_at desc);
create index pairings_account_date on public.pairings(user_id, created_at desc);
alter table public.devices enable row level security;
alter table public.pairings enable row level security;
alter table public.clips enable row level security;
create policy devices_read on public.devices for select to authenticated using (user_id = auth.uid());
create policy devices_update on public.devices for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy clips_read on public.clips for select to authenticated using (user_id = auth.uid() and expires_at > now());
create policy clips_update on public.clips for update to authenticated using (user_id = auth.uid() and expires_at > now()) with check (user_id = auth.uid());
create policy clips_delete on public.clips for delete to authenticated using (user_id = auth.uid());
revoke all on public.devices, public.pairings, public.clips from anon, authenticated;
grant select on public.devices, public.clips to authenticated;
grant update(name, revoked) on public.devices to authenticated;
grant update(pinned) on public.clips to authenticated;
grant delete on public.clips to authenticated;

create function public.guard_device_authorization() returns trigger language plpgsql set search_path = '' as $$
begin
 if current_user = 'authenticated' and old.revoked and not new.revoked then raise exception 'Device approval requires verified pairing'; end if;
 return new;
end $$;
create trigger guard_device_approval before update on public.devices for each row execute function public.guard_device_authorization();

create function public.create_pairing(device_name text, device_platform text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_device uuid; raw_code text;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if (select count(*) from public.pairings where user_id=auth.uid() and created_at > now()-interval '1 hour') >= 10 then raise exception 'Too many pairing requests. Try again later.'; end if;
 if (select count(*) from public.devices where user_id=auth.uid() and not revoked) >= 20 then raise exception 'Device limit reached'; end if;
 insert into public.devices(name,platform,user_id) values(trim(device_name),device_platform,auth.uid()) returning id into new_device;
 raw_code := upper(encode(extensions.gen_random_bytes(6),'hex'));
 insert into public.pairings(user_id,code_hash,initiator) values(auth.uid(),encode(extensions.digest(raw_code,'sha256'),'hex'),new_device);
 return jsonb_build_object('device_id',new_device,'code',raw_code,'expires_at',now()+interval '5 minutes');
end $$;

create function public.join_pairing(pairing_code text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.pairings; joining uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select * into target from public.pairings where user_id=auth.uid() and code_hash=encode(extensions.digest(upper(trim(pairing_code)),'sha256'),'hex') and expires_at>now() and not consumed for update;
 if target.id is null or target.participant is not null then raise exception 'Code expired, already requested, or not found in this account'; end if;
 select initiator into joining from public.pairings where user_id=auth.uid() and id<>target.id and expires_at>now() and not consumed order by created_at desc limit 1;
 if joining is null or joining=target.initiator then raise exception 'Create this device identity first'; end if;
 update public.pairings set participant=joining where id=target.id;
 return jsonb_build_object('device_id',joining,'pending',true);
end $$;

create function public.confirm_pairing(pairing_code text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.pairings;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select * into target from public.pairings where user_id=auth.uid() and code_hash=encode(extensions.digest(upper(trim(pairing_code)),'sha256'),'hex') and expires_at>now() and not consumed for update;
 if target.id is null then raise exception 'Pairing expired or unavailable'; end if;
 if target.participant is null then raise exception 'Waiting for your other device to enter this code'; end if;
 update public.devices set revoked=false,last_seen=now() where user_id=auth.uid() and id in (target.initiator,target.participant);
 update public.pairings set consumed=true where id=target.id;
 return jsonb_build_object('confirmed',true);
end $$;

create function public.cancel_pairing(pairing_code text) returns void language sql security definer set search_path = '' as $$
 delete from public.pairings where user_id=auth.uid() and code_hash=encode(extensions.digest(upper(trim(pairing_code)),'sha256'),'hex') and not consumed;
$$;

create function public.heartbeat(target_device uuid) returns void language sql security definer set search_path = '' as $$
 update public.devices set last_seen=now() where id=target_device and user_id=auth.uid() and not revoked;
$$;

create function public.send_clip(target_device uuid, clip_content text, keep_history boolean, retention_days integer) returns uuid language plpgsql security definer set search_path = '' as $$
declare sender public.devices; clip_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select * into sender from public.devices where id=target_device and user_id=auth.uid() and not revoked;
 if sender.id is null then raise exception 'Device is not authorized'; end if;
 if not exists(select 1 from public.devices where user_id=auth.uid() and not revoked and id<>target_device) then raise exception 'Pair another device first'; end if;
 if retention_days not in (1,7,30) then raise exception 'Invalid retention period'; end if;
 if (select count(*) from public.clips where user_id=auth.uid() and created_at>now()-interval '1 minute') >= 30 then raise exception 'Sending too quickly. Try again in a minute.'; end if;
 insert into public.clips(user_id,device_id,content,source,expires_at) values(auth.uid(),sender.id,trim(clip_content),sender.name,now()+make_interval(days=>case when keep_history then retention_days else 1 end)) returning id into clip_id;
 update public.devices set last_seen=now() where id=sender.id;
 return clip_id;
end $$;

create function public.acknowledge_clip(clip_id uuid,target_device uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.devices where id=target_device and user_id=auth.uid() and not revoked) then raise exception 'Device authorization revoked'; end if;
 update public.clips set acknowledged_at=now() where id=clip_id and user_id=auth.uid() and device_id<>target_device and expires_at>now() and acknowledged_at is null;
 if found then update public.devices set last_sync=now(),last_seen=now() where id=target_device and user_id=auth.uid(); end if;
end $$;

create function public.delete_my_account() returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 delete from auth.users where id=auth.uid();
end $$;

revoke execute on function public.create_pairing(text,text),public.join_pairing(text),public.confirm_pairing(text),public.cancel_pairing(text),public.heartbeat(uuid),public.send_clip(uuid,text,boolean,integer),public.acknowledge_clip(uuid,uuid),public.delete_my_account() from public, anon;
grant execute on function public.create_pairing(text,text),public.join_pairing(text),public.confirm_pairing(text),public.cancel_pairing(text),public.heartbeat(uuid),public.send_clip(uuid,text,boolean,integer),public.acknowledge_clip(uuid,uuid),public.delete_my_account() to authenticated;
alter publication supabase_realtime add table public.devices, public.clips;
select cron.schedule('clipsync-expiry','0 * * * *',$job$delete from public.clips where expires_at <= now(); delete from public.pairings where expires_at <= now(); delete from public.devices where revoked and last_seen < now() - interval '1 day';$job$);
