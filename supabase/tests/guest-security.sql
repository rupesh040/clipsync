begin;
create temporary table guest_check(key text primary key,value jsonb);grant all on guest_check to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$
declare host jsonb;phone jsonb;host_conn uuid:=gen_random_uuid();phone_conn uuid:=gen_random_uuid();result jsonb;
begin
 host:=public.guest_pair_operation(jsonb_build_object('op','create','name','Guest SQL test PC'),host_conn,'test-only');
 phone:=public.guest_pair_operation(jsonb_build_object('op','join','name','Guest SQL test phone','proof',jsonb_build_object('sessionId',host->'qr'->>'sessionId','secret',host->'qr'->>'secret')),phone_conn,'test-only');
 begin perform public.guest_pair_operation(jsonb_build_object('op','join','name','Replay','proof',jsonb_build_object('code',host->>'code')),gen_random_uuid(),'test-only');raise exception 'Replay accepted';exception when raise_exception then if sqlerrm<>'Pairing expired, consumed, or unavailable.' then raise;end if;end;
 begin perform public.guest_pair_operation(jsonb_build_object('op','confirm','auth',phone->'credentials'),phone_conn,'test-only');raise exception 'Phone approval accepted';exception when raise_exception then if sqlerrm<>'Only the initiating PC can confirm a pending phone' then raise;end if;end;
 perform public.guest_pair_operation(jsonb_build_object('op','confirm','auth',host->'credentials'),host_conn,'test-only');
 perform public.guest_pair_operation(jsonb_build_object('op','signal','auth',host->'credentials','signal',jsonb_build_object('kind','hello','session_id',gen_random_uuid(),'payload','{}'::jsonb)),host_conn,'test-only');
 result:=public.guest_pair_operation(jsonb_build_object('op','poll','auth',phone->'credentials'),phone_conn,'test-only');
 if result->'session'->>'status'<>'approved' or jsonb_array_length(result->'signals')<>1 then raise exception 'Signal transfer failed';end if;
 begin perform public.guest_pair_operation(jsonb_build_object('op','signal','auth',host->'credentials','signal',jsonb_build_object('kind','hello','session_id',gen_random_uuid(),'payload','{"text":"forbidden"}'::jsonb)),host_conn,'test-only');raise exception 'Text metadata accepted';exception when raise_exception then if sqlerrm<>'Hello must not contain data' then raise;end if;end;
 perform public.guest_pair_operation(jsonb_build_object('op','revoke','auth',phone->'credentials'),phone_conn,'test-only');
 begin perform public.guest_pair_operation(jsonb_build_object('op','authorize','auth',host->'credentials'),host_conn,'test-only');raise exception 'Revoked capability authorized';exception when raise_exception then if sqlerrm<>'Session expired or revoked' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$begin
 begin perform public.guest_pair_operation('{"op":"create","name":"Denied"}'::jsonb,gen_random_uuid(),'test');raise exception 'Anonymous RPC exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Guest capability role, single-use proof, host approval, metadata transfer, payload restrictions, revocation, and anonymous RPC denial passed; temporary records rolled back.' as result;
