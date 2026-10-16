begin;

create temporary table clipsync_test_context(key text primary key,value text);
grant all on clipsync_test_context to authenticated;
insert into clipsync_test_context values('user_a',gen_random_uuid()::text),('user_b',gen_random_uuid()::text);
insert into auth.users(id,email,raw_user_meta_data,created_at,updated_at)
 select value::uuid,value||'@example.invalid','{}'::jsonb,now(),now() from clipsync_test_context;

select set_config('request.jwt.claims',json_build_object('sub',(select value from clipsync_test_context where key='user_a'),'role','authenticated')::text,true);
set local role authenticated;

do $$
declare first_device jsonb; second_device jsonb; sent_clip uuid; accepted boolean;
begin
 if (select history_enabled from public.profiles where id=auth.uid()) then raise exception 'History must default to off'; end if;
 first_device := public.create_pairing('Test PC','Windows desktop');
 second_device := public.create_pairing('Test Phone','Android phone');
 if exists(select 1 from public.devices where not revoked) then raise exception 'Unconfirmed devices must remain unauthorized'; end if;
 begin
  perform public.send_clip((first_device->>'device_id')::uuid,'test-only',false,7);
  raise exception 'SECURITY: unapproved send succeeded';
 exception when raise_exception then
  if sqlerrm='SECURITY: unapproved send succeeded' then raise; end if;
 end;
 perform public.join_pairing(first_device->>'code',(second_device->>'device_id')::uuid);
 perform public.confirm_pairing(first_device->>'code');
 if (select count(*) from public.devices where not revoked)<>2 then raise exception 'Confirmed pairing did not authorize both devices'; end if;
 sent_clip := public.send_clip((first_device->>'device_id')::uuid,'test-only',false,7);
 accepted := public.acknowledge_clip(sent_clip,(second_device->>'device_id')::uuid);
 if not accepted then raise exception 'First receipt must succeed'; end if;
 if public.acknowledge_clip(sent_clip,(second_device->>'device_id')::uuid) then raise exception 'Repeated receipt must be idempotent'; end if;
 if public.acknowledge_clip(sent_clip,(first_device->>'device_id')::uuid) then raise exception 'Source must not acknowledge itself'; end if;
 for send_number in 1..29 loop
  perform public.send_clip((first_device->>'device_id')::uuid,'rate-limit-test-only',false,7);
  delete from public.clips where content='rate-limit-test-only';
 end loop;
 begin
  perform public.send_clip((first_device->>'device_id')::uuid,'rate-limit-test-only',false,7);
  raise exception 'SECURITY: deleted history bypassed rate limiting';
 exception when raise_exception then
  if sqlerrm<>'Rate limit reached. Try again later.' then raise; end if;
 end;
 update public.devices set revoked=true where id=(second_device->>'device_id')::uuid;
 begin
  update public.devices set revoked=false where id=(second_device->>'device_id')::uuid;
  raise exception 'SECURITY: direct authorization succeeded';
 exception when raise_exception then
  if sqlerrm='SECURITY: direct authorization succeeded' then raise; end if;
 end;
 begin
  perform public.acknowledge_clip(sent_clip,(second_device->>'device_id')::uuid);
  raise exception 'SECURITY: revoked receipt succeeded';
 exception when raise_exception then
  if sqlerrm='SECURITY: revoked receipt succeeded' then raise; end if;
 end;
 insert into clipsync_test_context values('clip',sent_clip::text),('device',first_device->>'device_id');
end $$;

reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select value from clipsync_test_context where key='user_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$
begin
 if exists(select 1 from public.devices) or exists(select 1 from public.clips) or exists(select 1 from public.clip_receipts) then raise exception 'Cross-account data was exposed'; end if;
 if (select count(*) from public.profiles)<>1 then raise exception 'Profile RLS failed'; end if;
 begin
  insert into public.clips(user_id,device_id,content,source,expires_at) values(auth.uid(),(select value::uuid from clipsync_test_context where key='device'),'test-only','test',now()+interval '1 day');
  raise exception 'SECURITY: direct clip insertion succeeded';
 exception when insufficient_privilege then null;
 end;
end $$;

reset role;
update public.clips set expires_at=now()-interval '1 second' where id=(select value::uuid from clipsync_test_context where key='clip');
select set_config('request.jwt.claims',json_build_object('sub',(select value from clipsync_test_context where key='user_a'),'role','authenticated')::text,true);
set local role authenticated;
do $$
begin
 if exists(select 1 from public.clips) then raise exception 'Expired content was exposed'; end if;
 perform public.set_preferences(true,30);
 if not (select history_enabled and retention_days=30 from public.profiles where id=auth.uid()) then raise exception 'Preferences did not persist'; end if;
 perform public.set_preferences(false,7);
end $$;
reset role;

do $$
begin
 if exists(select 1 from public.clips where user_id=(select value::uuid from clipsync_test_context where key='user_a')) then raise exception 'Disabling history failed to delete stored content'; end if;
end $$;

rollback;
select 'Clipsync authorization, pairing, receipt, expiry, and deletion checks passed; test data rolled back.' as result;
