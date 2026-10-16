import {test} from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import WebSocket from 'ws';
import {PairingStore,RateLimits} from '../server/pairing-store';
import {createSignalingService} from '../server/service';
import {GuestClient,shouldRecoverSession} from '../packages/pairing/client';
import {GuestSignaling} from '../packages/transport/guest-signaling';
import {parsePairingQr,signalingUrl} from '../packages/pairing/protocol';
import {ClipboardPeer} from '../packages/transport/peer';
import {FakePeer} from './helpers/fake-rtc';
import {waitFor} from './helpers/memory-signaling';
import {stopQrCamera,cameraError} from '../lib/qr-camera';
import {createHash,createPublicKey} from 'node:crypto';
import identity from '../extension/identity.json';

test('QR generation contains temporary capabilities, rejects malformed, foreign, expired, and unsupported QR payloads',async()=>{
 const store=new PairingStore('test'),created=store.create('Test PC'),raw=JSON.stringify(created.qr);
 assert.equal(parsePairingQr(raw,'test').deviceName,'Test PC');assert.match(await QRCode.toDataURL(raw),/^data:image\/png;base64,/);
 for(const value of ['{}','https://evil.example',JSON.stringify({...created.qr,version:2}),JSON.stringify({...created.qr,endpoint:'wss://evil.example'}),JSON.stringify({...created.qr,expiresAt:Date.now()-1})])assert.throws(()=>parsePairingQr(value,'test'));
 assert.throws(()=>parsePairingQr(raw,'foreign'));assert.throws(()=>signalingUrl('ws://public.example/signal'));assert.throws(()=>signalingUrl('wss://user:secret@example.com/signal'));assert.equal(signalingUrl('wss://example.com/signal'),'wss://example.com/signal');
});

test('public extension manifest key has the exact allowlisted stable ID',()=>{
 const key=Buffer.from(identity.key,'base64');assert.equal(createPublicKey({key,format:'der',type:'spki'}).asymmetricKeyType,'rsa');
 const id=createHash('sha256').update(key).digest('hex').slice(0,32).replace(/[0-9a-f]/g,value=>String.fromCharCode(97+parseInt(value,16)));assert.equal(id,identity.id);
 assert.equal(signalingUrl('wss://example.supabase.co/functions/v1/clipsync-signal/signal'),'wss://example.supabase.co/functions/v1/clipsync-signal/signal');
});

test('foregrounding a healthy session does not trigger reconnect; only an offline approved session recovers',()=>{
 const store=new PairingStore('test'),host=store.create('PC'),phone=store.join({code:host.code},'Phone');store.confirm(host.credentials);
 const state={session:store.state(phone.credentials),qr:null,code:'',online:true,error:''};
 assert.equal(shouldRecoverSession(state),false);assert.equal(shouldRecoverSession({...state,online:false}),true);assert.equal(shouldRecoverSession({...state,session:null,online:false}),false);assert.equal(shouldRecoverSession({...state,session:{...state.session,status:'expired'},online:false}),false);
});
test('pairing is single-use, host-confirmed, expiring, role-bound, and revocable without accounts',()=>{
 let now=1_000_000;const store=new PairingStore('test',()=>now),host=store.create('PC');
 assert.throws(()=>store.join({sessionId:host.qr.sessionId,secret:'x'.repeat(43)},'Attacker'));
 const phone=store.join({sessionId:host.qr.sessionId,secret:host.qr.secret},'Phone');assert.equal(store.authorized(phone.credentials),false);
 assert.throws(()=>store.join({code:host.code},'Replay'));assert.throws(()=>store.confirm(phone.credentials));
 store.confirm(host.credentials);assert.equal(store.authorized(phone.credentials),true);assert.equal(store.state(phone.credentials).verification,store.state(host.credentials).verification);
 store.revoke(phone.credentials);assert.throws(()=>store.authorized(host.credentials));
 const expired=store.create('Expired PC');now+=300_001;assert.throws(()=>store.join({code:expired.code},'Phone'));
 const another=store.create('PC2');const secondPhone=store.join({code:another.code},'Phone2');store.confirm(another.credentials);now+=7_200_001;assert.throws(()=>store.authorized(secondPhone.credentials));
});
test('pairing and global traffic rate limits reject repeated guessing and recover after window',()=>{
 let now=0;const limits=new RateLimits(()=>now);limits.take('ip',2);limits.take('ip',2);assert.throws(()=>limits.take('ip',2));now=60_001;assert.doesNotThrow(()=>limits.take('ip',2));
});
test('camera cleanup stops tracks and denied permission offers manual fallback',()=>{
 let stopped=0,destroyed=0;const video={srcObject:{getTracks:()=>[{stop:()=>{stopped++;}}]}} as unknown as HTMLVideoElement;
 stopQrCamera({stop:()=>{stopped++;},destroy:()=>{destroyed++;},start:async()=>{},hasFlash:async()=>false,toggleFlash:async()=>{}},video);
 assert.equal(stopped,2);assert.equal(destroyed,1);assert.equal(video.srcObject,null);assert.match(cameraError(new DOMException('Denied','NotAllowedError')),/pairing-code fallback/);
});
test('real WebSocket service authorizes metadata, delivers via transport, reconnects, and revokes both peers',async()=>{
 const origin='http://localhost:3000',service=createSignalingService({origins:[origin],serviceId:'test'});
 await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 const address=service.server.address();if(!address||typeof address==='string')throw new Error('No server port');
 const endpoint='ws://127.0.0.1:'+address.port+'/signal';
 const factory=(url:string)=>new WebSocket(url,{origin}) as unknown as globalThis.WebSocket;
 const host=new GuestClient(endpoint,'test',factory),phone=new GuestClient(endpoint,'test',factory);
 let first:ClipboardPeer|undefined,second:ClipboardPeer|undefined;
 try{
  await host.create('PC');const qr=host.getSnapshot().qr!;const preview=await phone.inspect({code:host.getSnapshot().code});assert.equal(preview.deviceName,'PC');
  await phone.join({sessionId:qr.sessionId,secret:qr.secret},'Phone');await assert.rejects(phone.request('confirm'));await assert.rejects(phone.request('configuration'));
  await host.confirm();await waitFor(()=>phone.getSnapshot().session?.status==='approved');
  const firstState=host.getSnapshot().session!,secondState=phone.getSnapshot().session!,states=new Map<string,string>(),received:string[]=[];
  const make=(client:GuestClient,local:string,remote:string)=>{const signaling=new GuestSignaling(client);return new ClipboardPeer({local,remote,signaling,configuration:()=>signaling.configuration(),onState:value=>states.set(local,value),onClipboard:value=>{received.push(value.text);},createPeer:()=>new FakePeer() as unknown as RTCPeerConnection});};
  first=make(host,firstState.deviceId,secondState.deviceId);second=make(phone,secondState.deviceId,firstState.deviceId);
  await Promise.all([first.start(),second.start()]);await waitFor(()=>states.get(firstState.deviceId)==='connected'&&states.get(secondState.deviceId)==='connected');
  await first.send('No login\nReal WebSocket signaling');assert.equal(received[0],'No login\nReal WebSocket signaling');
  await assert.rejects(host.request('signal',{signal:{kind:'hello',session_id:crypto.randomUUID(),payload:{text:'forbidden'}}}));
  await phone.reconnect();assert.equal(phone.getSnapshot().online,true);
  await phone.revoke();await waitFor(()=>host.getSnapshot().session?.status==='revoked'||!host.getSnapshot().online);await assert.rejects(first.send('revoked'));
 }finally{await first?.stop();await second?.stop();host.close();phone.close();await service.close();}
});
test('WebSocket upgrade rejects an untrusted origin',async()=>{
 const service=createSignalingService({origins:['http://localhost:3000'],serviceId:'test'});await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 const address=service.server.address();if(!address||typeof address==='string')throw new Error('No port');
 try{await new Promise<void>((resolve,reject)=>{const socket=new WebSocket('ws://127.0.0.1:'+address.port+'/signal',{origin:'https://evil.example'});socket.on('open',()=>{socket.close();reject(new Error('Untrusted origin accepted'));});socket.on('error',()=>resolve());});}finally{await service.close();}
});

test('an expired server capability can be replaced by a fresh pairing without reloading',async()=>{
 let now=Date.now();const origin='http://localhost:3000',service=createSignalingService({origins:[origin],serviceId:'test',now:()=>now});
 await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));const address=service.server.address();if(!address||typeof address==='string')throw new Error('No port');
 const client=new GuestClient('ws://127.0.0.1:'+address.port+'/signal','test',url=>new WebSocket(url,{origin}) as unknown as globalThis.WebSocket);
 try{await client.create('PC');const old=client.getSnapshot().session?.sessionId;now+=300_001;await assert.rejects(client.request('authorize'));assert.equal(client.getSnapshot().session?.status,'expired');await client.create('Fresh PC');assert.notEqual(client.getSnapshot().session?.sessionId,old);assert.equal(client.getSnapshot().session?.status,'waiting');}
 finally{client.close();await service.close();}
});

test('authorized operations reattach a newly opened socket before revocation after abrupt network loss',async()=>{
 const origin='http://localhost:3000',service=createSignalingService({origins:[origin],serviceId:'test'});await new Promise<void>(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 const address=service.server.address();if(!address||typeof address==='string')throw new Error('No port');const sockets:WebSocket[]=[];
 const client=new GuestClient('ws://127.0.0.1:'+address.port+'/signal','test',url=>{const socket=new WebSocket(url,{origin});sockets.push(socket);return socket as unknown as globalThis.WebSocket;});
 try{await client.create('Network test PC');const room=client.getSnapshot().session!.sessionId;sockets[0].terminate();await client.revoke();assert.equal(client.getSnapshot().session,null);assert(service.store.states(room).every(state=>state.status==='revoked'));assert(sockets.length>=2);}
 finally{client.close();await service.close();}
});
