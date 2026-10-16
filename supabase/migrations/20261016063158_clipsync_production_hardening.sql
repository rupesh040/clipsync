create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.rate_limits (
 user_id uuid not null references auth.users(id) on delete cascade,
 action text not null,
 bucket timestamptz not null,
 attempts integer not null,
 primary key(user_id, action, bucket)
);
alter table private.rate_limits enable row level security;

create function private.consume_limit(action_name text, maximum integer, window_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare attempts_used integer;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 insert into private.rate_limits(user_id,action,bucket,attempts)
 values(auth.uid(),action_name,date_trunc(window_name,now()),1)
 on conflict(user_id,action,bucket) do update set attempts=private.rate_limits.attempts+1
 returning attempts into attempts_used;
 if attempts_used > maximum then raise exception 'Rate limit reached. Try again later.'; end if;
end $$;
revoke all on function private.consume_limit(text,integer,text) from public, anon, authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 history_enabled boolean not null default false,
 retention_days integer not null default 7 check (retention_days in (1,7,30)),
 created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid());
insert into public.profiles(id,history_enabled,retention_days)
 select id,(raw_user_meta_data->>'history'='true') is true,
 case when raw_user_meta_data->>'retention' in ('1','7','30') then (raw_user_meta_data->>'retention')::integer else 7 end
 from auth.users on conflict do nothing;

create function private.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id) values(new.id) on conflict do nothing;
 return new;
end $$;
revoke all on function private.create_profile() from public, anon, authenticated;
create trigger clipsync_profile_created after insert on auth.users for each row execute function private.create_profile();

create function public.set_preferences(history_enabled boolean, retention_days integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if history_enabled is null or retention_days is null or retention_days not in (1,7,30) then raise exception 'Invalid preferences'; end if;
 update public.profiles set history_enabled=set_preferences.history_enabled,retention_days=set_preferences.retention_days where id=auth.uid();
 if not found then raise exception 'Account profile is unavailable'; end if;
 if not history_enabled then delete from public.clips where user_id=auth.uid(); end if;
end $$;

create table public.clip_receipts (
 clip_id uuid not null references public.clips(id) on delete cascade,
 device_id uuid not null references public.devices(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 received_at timestamptz not null default now(),
 primary key(clip_id,device_id)
);
alter table public.clip_receipts enable row level security;
revoke all on public.clip_receipts from anon, authenticated;
grant select on public.clip_receipts to authenticated;
create policy receipt_read on public.clip_receipts for select to authenticated using(user_id=auth.uid());

create or replace function public.create_pairing(device_name text, device_platform text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare new_device uuid; raw_code text;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if device_name is null or length(trim(device_name)) not between 1 and 60 then raise exception 'Device name must have 1 to 60 characters'; end if;
 if device_platform is null or device_platform not in ('Windows desktop','macOS desktop','Android phone','iPhone or iPad','Another browser') then raise exception 'Unsupported platform'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 perform private.consume_limit('pair',10,'hour');
 if (select count(*) from public.devices where user_id=auth.uid() and not revoked) >= 20 then raise exception 'Device limit reached'; end if;
 insert into public.devices(name,platform,user_id) values(trim(device_name),device_platform,auth.uid()) returning id into new_device;
 raw_code := upper(encode(extensions.gen_random_bytes(6),'hex'));
 insert into public.pairings(user_id,code_hash,initiator) values(auth.uid(),encode(extensions.digest(raw_code,'sha256'),'hex'),new_device);
 return jsonb_build_object('device_id',new_device,'code',raw_code,'expires_at',now()+interval '5 minutes');
end $$;

drop function public.join_pairing(text);
create function public.join_pairing(pairing_code text, joining_device uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.pairings;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if pairing_code is null or pairing_code !~ '^[A-Fa-f0-9]{12}$' then raise exception 'Invalid pairing code'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select * into target from public.pairings where user_id=auth.uid() and code_hash=encode(extensions.digest(upper(pairing_code),'sha256'),'hex') and expires_at>now() and not consumed for update;
 if target.id is null or target.participant is not null then raise exception 'Code expired, already requested, or unavailable'; end if;
 if joining_device=target.initiator or not exists(select 1 from public.devices where id=joining_device and user_id=auth.uid() and revoked) then raise exception 'Invalid joining device'; end if;
 if not exists(select 1 from public.pairings where initiator=joining_device and user_id=auth.uid() and expires_at>now() and not consumed) then raise exception 'Joining device registration expired'; end if;
 if exists(select 1 from public.pairings where participant=joining_device and not consumed and expires_at>now()) then raise exception 'Device already has a pending request'; end if;
 update public.pairings set participant=joining_device where id=target.id;
 return jsonb_build_object('device_id',joining_device,'pending',true);
end $$;

create or replace function public.confirm_pairing(pairing_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target public.pairings; new_devices integer;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select * into target from public.pairings where user_id=auth.uid() and code_hash=encode(extensions.digest(upper(trim(pairing_code)),'sha256'),'hex') and expires_at>now() and not consumed for update;
 if target.id is null then raise exception 'Pairing expired or unavailable'; end if;
 if target.participant is null then raise exception 'Waiting for your other device to enter this code'; end if;
 select count(*) into new_devices from public.devices where user_id=auth.uid() and id in(target.initiator,target.participant) and revoked;
 if (select count(*) from public.devices where user_id=auth.uid() and not revoked)+new_devices>20 then raise exception 'Device limit reached'; end if;
 update public.devices set revoked=false,last_seen=now() where user_id=auth.uid() and id in(target.initiator,target.participant);
 update public.pairings set consumed=true where user_id=auth.uid() and (initiator in(target.initiator,target.participant) or participant in(target.initiator,target.participant));
 return jsonb_build_object('confirmed',true);
end $$;

create or replace function public.send_clip(target_device uuid, clip_content text, keep_history boolean, retention_days integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sender public.devices; clip_id uuid; preferences public.profiles;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if clip_content is null or length(trim(clip_content)) not between 1 and 20000 then raise exception 'Enter 1 to 20,000 characters'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select * into sender from public.devices where id=target_device and user_id=auth.uid() and not revoked;
 if sender.id is null then raise exception 'Device is not authorized'; end if;
 if not exists(select 1 from public.devices where user_id=auth.uid() and not revoked and id<>target_device) then raise exception 'Pair another device first'; end if;
 select * into preferences from public.profiles where id=auth.uid();
 if preferences.id is null then raise exception 'Account profile is unavailable'; end if;
 if keep_history is distinct from preferences.history_enabled or retention_days is distinct from preferences.retention_days then raise exception 'Privacy settings changed. Refresh before sending.'; end if;
 perform private.consume_limit('send',30,'minute');
 insert into public.clips(user_id,device_id,content,source,expires_at)
 values(auth.uid(),sender.id,trim(clip_content),sender.name,now()+make_interval(days=>case when preferences.history_enabled then preferences.retention_days else 1 end)) returning id into clip_id;
 update public.devices set last_seen=now() where id=sender.id;
 return clip_id;
end $$;

drop function public.acknowledge_clip(uuid,uuid);
create function public.acknowledge_clip(clip_id uuid,target_device uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare source_device uuid;
begin
 if not exists(select 1 from public.devices where id=target_device and user_id=auth.uid() and not revoked) then raise exception 'Device authorization revoked'; end if;
 select device_id into source_device from public.clips where id=clip_id and user_id=auth.uid() and device_id<>target_device and expires_at>now();
 if source_device is null then return false; end if;
 insert into public.clip_receipts(clip_id,device_id,user_id) values(clip_id,target_device,auth.uid()) on conflict do nothing;
 if not found then return false; end if;
 update public.clips set acknowledged_at=coalesce(acknowledged_at,now()) where id=clip_id;
 update public.devices set last_sync=now() where id in(target_device,source_device) and user_id=auth.uid();
 return true;
end $$;

create function public.health_check() returns jsonb language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object('schema_version',2,'auth_required',true,'history_default',false);
$$;
revoke all on function public.set_preferences(boolean,integer),public.join_pairing(text,uuid),public.acknowledge_clip(uuid,uuid),public.health_check() from public,anon;
grant execute on function public.set_preferences(boolean,integer),public.join_pairing(text,uuid),public.acknowledge_clip(uuid,uuid),public.health_check() to authenticated;

alter publication supabase_realtime add table public.profiles;
select cron.unschedule('clipsync-expiry');
select cron.schedule('clipsync-expiry','0 * * * *',$job$
 delete from public.clips where expires_at<=now();
 delete from public.pairings where created_at<now()-interval '1 hour';
 delete from private.rate_limits where bucket<now()-interval '2 hours';
 delete from public.devices where revoked and last_seen<now()-interval '1 day';
$job$);
