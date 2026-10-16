create table public.rtc_signals (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 from_device uuid not null references public.devices(id) on delete cascade,
 to_device uuid not null references public.devices(id) on delete cascade,
 session_id uuid not null,
 kind text not null check(kind in ('hello','offer','answer','ice')),
 payload jsonb not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '45 seconds',
 check(from_device<>to_device),
 check(pg_column_size(payload)<72000)
);
create index rtc_signals_recipient_date on public.rtc_signals(to_device,created_at);
create index rtc_signals_expiry on public.rtc_signals(expires_at);
alter table public.rtc_signals enable row level security;
revoke all on public.rtc_signals from public,anon,authenticated;
grant select on public.rtc_signals to authenticated;
create policy rtc_signals_read on public.rtc_signals for select to authenticated using(
 user_id=(select auth.uid()) and expires_at>now()
 and exists(select 1 from public.devices where id=from_device and user_id=(select auth.uid()) and not revoked)
 and exists(select 1 from public.devices where id=to_device and user_id=(select auth.uid()) and not revoked)
);

create function public.authorize_peer(local_device uuid,remote_device uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
 select auth.uid() is not null and local_device<>remote_device and
 (select count(*)=2 from public.devices where id in(local_device,remote_device) and user_id=auth.uid() and not revoked);
$$;

create function public.authorize_rtc_configuration(local_device uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.devices where id=local_device and user_id=auth.uid() and not revoked) then return false; end if;
 perform private.consume_limit('rtc_config_'||local_device::text,120,'hour');
 return true;
end $$;

create function public.send_rtc_signal(local_device uuid,remote_device uuid,connection_id uuid,signal_kind text,signal_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare signal_id uuid;
begin
 if not public.authorize_peer(local_device,remote_device) then raise exception 'Device authorization rejected'; end if;
 if connection_id is null or signal_payload is null or jsonb_typeof(signal_payload)<>'object' or pg_column_size(signal_payload)>71000 then raise exception 'Invalid signaling payload'; end if;
 if signal_kind='hello' then
  if signal_payload<>'{}'::jsonb then raise exception 'Hello must not contain data'; end if;
 elsif signal_kind in ('offer','answer') then
  if signal_payload-array['sdp','type']<>'{}'::jsonb or not(signal_payload ?& array['sdp','type']) or jsonb_typeof(signal_payload->'sdp')<>'string' or length(signal_payload->>'sdp')>64000 or signal_payload->>'type'<>signal_kind then raise exception 'Only SDP is permitted'; end if;
 elsif signal_kind='ice' then
  if signal_payload-array['candidate','sdpMid','sdpMLineIndex','usernameFragment']<>'{}'::jsonb or not(signal_payload ? 'candidate') or jsonb_typeof(signal_payload->'candidate')<>'string' or length(signal_payload->>'candidate')>4096 then raise exception 'Only ICE metadata is permitted'; end if;
 else raise exception 'Unsupported signal kind';
 end if;
 perform private.consume_limit('rtc_signal_'||local_device::text,180,'minute');
 insert into public.rtc_signals(user_id,from_device,to_device,session_id,kind,payload)
 values(auth.uid(),local_device,remote_device,connection_id,signal_kind,signal_payload) returning id into signal_id;
 return signal_id;
end $$;

revoke all on function public.authorize_peer(uuid,uuid),public.authorize_rtc_configuration(uuid),public.send_rtc_signal(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.authorize_peer(uuid,uuid),public.authorize_rtc_configuration(uuid),public.send_rtc_signal(uuid,uuid,uuid,text,jsonb) to authenticated;
revoke execute on function public.send_clip(uuid,text,boolean,integer) from authenticated;

alter publication supabase_realtime add table public.rtc_signals;
select cron.schedule('clipsync-signaling-expiry','* * * * *',$job$delete from public.rtc_signals where expires_at<=now();$job$);
