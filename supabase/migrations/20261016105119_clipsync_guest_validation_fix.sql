create or replace function public.guest_pair_operation(message jsonb,connection_id uuid,ip_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 operation text:=message->>'op';room private.guest_rooms;device_role text;local_id uuid;remote_id uuid;
 credential text;secret text;code text;proof jsonb:=message->'proof';auth jsonb:=message->'auth';result jsonb;events jsonb;payload jsonb;
begin
 if coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','')<>'service_role' then raise exception 'Service authorization required';end if;
 if connection_id is null or length(ip_digest)>128 or pg_column_size(message)>72000 then raise exception 'Invalid request';end if;
 if operation='create' then
  perform private.guest_limit('create:'||ip_digest,6);perform private.guest_limit('create:global',120);
  perform pg_advisory_xact_lock(hashtext('clipsync_guest_create'));
  if (select count(*) from private.guest_rooms where expires_at>now() and status<>'revoked')>=1000 then raise exception 'Pairing capacity reached';end if;
  secret:=private.guest_token();credential:=private.guest_token();code:=upper(encode(extensions.gen_random_bytes(6),'hex'));
  insert into private.guest_rooms(host_name,host_token,qr_secret,manual_code,verification,host_connection)
  values(message->>'name',extensions.digest(credential,'sha256'),extensions.digest(secret,'sha256'),extensions.digest(code,'sha256'),upper(encode(extensions.gen_random_bytes(3),'hex')),connection_id) returning * into room;
  return jsonb_build_object('credentials',jsonb_build_object('sessionId',room.id,'token',credential,'deviceId',room.host_id,'expiresAt',floor(extract(epoch from room.expires_at)*1000)::bigint),
   'qr',jsonb_build_object('version',1,'service','clipsync-pair','serviceId','clipsync','sessionId',room.id,'secret',secret,'expiresAt',floor(extract(epoch from room.pair_expires)*1000)::bigint,'deviceName',room.host_name),
   'code',code,'session',private.guest_view(room,'host'));
 elsif operation in('inspect','join') then
  perform private.guest_limit('pair:'||ip_digest,12);perform private.guest_limit('pair:global',300);
  if proof ? 'code' then select * into room from private.guest_rooms where manual_code=extensions.digest(proof->>'code','sha256') and status='waiting' and pair_expires>now() for update;
  else select * into room from private.guest_rooms where id=(proof->>'sessionId')::uuid and qr_secret=extensions.digest(proof->>'secret','sha256') and status='waiting' and pair_expires>now() for update;end if;
  if room.id is null then raise exception 'Pairing expired, consumed, or unavailable.';end if;
  if operation='inspect' then return jsonb_build_object('sessionId',room.id,'deviceName',room.host_name,'expiresAt',floor(extract(epoch from room.pair_expires)*1000)::bigint,'serviceId','clipsync');end if;
  credential:=private.guest_token();
  update private.guest_rooms set phone_id=gen_random_uuid(),phone_name=message->>'name',phone_token=extensions.digest(credential,'sha256'),phone_connection=connection_id,status='pending',qr_secret=extensions.gen_random_bytes(32),manual_code=extensions.gen_random_bytes(32) where id=room.id returning * into room;
  return jsonb_build_object('credentials',jsonb_build_object('sessionId',room.id,'token',credential,'deviceId',room.phone_id,'expiresAt',floor(extract(epoch from room.expires_at)*1000)::bigint),'session',private.guest_view(room,'phone'));
 end if;
 select * into room from private.guest_rooms where id=(auth->>'sessionId')::uuid for update;
 if room.id is null or room.expires_at<=now() then raise exception 'Session expired or revoked';end if;
 if room.host_token=extensions.digest(auth->>'token','sha256') then device_role:='host';local_id:=room.host_id;remote_id:=room.phone_id;
 elsif room.phone_token=extensions.digest(auth->>'token','sha256') then device_role:='phone';local_id:=room.phone_id;remote_id:=room.host_id;
 else raise exception 'Session authorization rejected';end if;
 if operation='attach' then
  if room.status='revoked' then raise exception 'Session expired or revoked';end if;
  if device_role='host' then update private.guest_rooms set host_connection=connection_id where id=room.id returning * into room;
  else update private.guest_rooms set phone_connection=connection_id where id=room.id returning * into room;end if;
  return jsonb_build_object('session',private.guest_view(room,device_role));
 end if;
 if (device_role='host' and room.host_connection is distinct from connection_id) or (device_role='phone' and room.phone_connection is distinct from connection_id) then raise exception 'Session opened elsewhere';end if;
 if operation='poll' then
  with consumed as(delete from private.guest_events where id in(select id from private.guest_events where room_id=room.id and recipient=local_id and expires_at>now() order by id limit 128) returning id,signal)
  select coalesce(jsonb_agg(signal order by id),'[]'::jsonb) into events from consumed;
  return jsonb_build_object('session',private.guest_view(room,device_role),'signals',events);
 end if;
 if room.status='revoked' then raise exception 'Session expired or revoked';end if;
 if operation='confirm' then
  if device_role<>'host' or room.status<>'pending' or room.phone_id is null then raise exception 'Only the initiating PC can confirm a pending phone';end if;
  update private.guest_rooms set status='approved',expires_at=now()+interval '2 hours' where id=room.id returning * into room;
  return jsonb_build_object('session',private.guest_view(room,device_role));
 elsif operation='revoke' then update private.guest_rooms set status='revoked' where id=room.id;delete from private.guest_events where room_id=room.id;return jsonb_build_object('revoked',true);
 elsif operation='authorize' then return jsonb_build_object('authorized',room.status='approved');
 elsif operation in('configuration','signal') then
  if room.status<>'approved' then raise exception 'Confirm pairing before signaling';end if;
  if operation='configuration' then perform private.guest_limit('config:'||room.id::text,10);return jsonb_build_object('sessionId',room.id,'deviceId',local_id);end if;
  perform private.guest_limit('signal:'||room.id::text||':'||device_role,180);
  payload:=message->'signal';
  if payload is null or payload-array['kind','payload','session_id']<>'{}'::jsonb or (payload->>'kind') not in('hello','offer','answer','ice') then raise exception 'Invalid signaling metadata';end if;
  if payload->>'kind'='hello' and payload->'payload'<>'{}'::jsonb then raise exception 'Hello must not contain data';end if;
  if payload->>'kind' in('offer','answer') and ((payload->'payload')-array['sdp','type']<>'{}'::jsonb or payload->'payload'->>'type' is distinct from payload->>'kind' or jsonb_typeof(payload->'payload'->'sdp') is distinct from 'string' or length(payload->'payload'->>'sdp')>64000) then raise exception 'Only SDP is permitted';end if;
  if payload->>'kind'='ice' and ((payload->'payload')-array['candidate','sdpMid','sdpMLineIndex','usernameFragment']<>'{}'::jsonb or jsonb_typeof(payload->'payload'->'candidate') is distinct from 'string' or length(payload->'payload'->>'candidate')>4096) then raise exception 'Only ICE is permitted';end if;
  payload:=payload||jsonb_build_object('id',gen_random_uuid(),'from_device',local_id,'to_device',remote_id);
  insert into private.guest_events(room_id,recipient,signal) values(room.id,remote_id,payload);
  return jsonb_build_object('accepted',true);
 end if;
 raise exception 'Unsupported request';
end $$;
