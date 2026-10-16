import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {TransferLedger,type RecoveryStorage} from '../packages/transport/ledger';
import {ClipboardPeer} from '../packages/transport/peer';
import {GuestClient} from '../packages/pairing/client';
import {createSignalingService} from '../server/service';
import {MemorySignalBus,waitFor} from './helpers/memory-signaling';
import {FakePeer} from './helpers/fake-rtc';
const local='11111111-1111-4111-8111-111111111111',remote='22222222-2222-4222-8222-222222222222';
function memory(){let value:unknown=null;const storage:RecoveryStorage={load:async()=>structuredClone(value),save:async next=>{value=structuredClone(next);}};return storage;}

test('outbox restores unacknowledged updates with stable IDs and deletes only acknowledged entries',async()=>{
 const storage=memory(),first=new TransferLedger(local,remote,storage),message=await first.add('Offline\ntext 🙂','page-copy');
 const restored=new TransferLedger(local,remote,storage);await restored.ready;assert.equal(restored.entries()[0].id,message.id);assert.equal(restored.entries()[0].text,message.text);
 await restored.acknowledge(message.id);const empty=new TransferLedger(local,remote,storage);await empty.ready;assert.equal(empty.size,0);
});

test('persisted receive watermark rejects duplicates and stale queued overwrites after reload',async()=>{
 const sender=new TransferLedger(local,remote),storage=memory(),receiver=new TransferLedger(remote,local,storage);
 const old=await sender.add('Old offline text','page-copy'),newer={...old,id:crypto.randomUUID(),timestamp:old.timestamp+1,text:'Newer clipboard'};
 let applied=0;assert.equal(await receiver.accept(newer,()=>{applied++;}),true);
 const restored=new TransferLedger(remote,local,storage);await restored.ready;
 assert.equal(await restored.accept(old,()=>{applied++;}),false);assert.equal(await restored.accept(newer,()=>{applied++;}),false);assert.equal(applied,1);
 const localCopy=await restored.add('A later local copy','page-copy');assert(localCopy.timestamp>=newer.timestamp);assert.equal(await restored.accept(newer,()=>{applied++;}),false);
});

test('outbox is bounded, refuses storage failure without claiming a durable queue, and isolates peers/expiry',async()=>{
 const ledger=new TransferLedger(local,remote);for(let index=0;index<32;index++)await ledger.add('Copy '+index,'page-copy');await assert.rejects(ledger.add('Overflow','page-copy'),/queue is full/);assert.equal(ledger.size,32);
 const full=new TransferLedger(local,remote,{load:async()=>null,save:async()=>{throw new Error('Quota exceeded');}});await assert.rejects(full.add('Unsaved','manual'),/Quota/);assert.equal(full.size,0);
 const storage=memory(),original=new TransferLedger(local,remote,storage);await original.add('Private peer text','manual');const wrongPeer=new TransferLedger(remote,local,storage);await wrongPeer.ready;assert.equal(wrongPeer.size,0);
 await original.clear();const expired=new TransferLedger(local,remote,storage);await expired.ready;assert.equal(expired.size,0);
});

test('receive still acknowledges once in memory when browser recovery storage is denied',async()=>{
 const sender=new TransferLedger(local,remote),receiver=new TransferLedger(remote,local,{load:async()=>{throw new Error('Denied');},save:async()=>{throw new Error('Denied');}});
 const message=await sender.add('Incoming still works','manual');let received=0;assert.equal(await receiver.accept(message,()=>{received++;}),true);assert.equal(await receiver.accept(message,()=>{received++;}),false);assert.equal(received,1);assert.match(receiver.storageError,/memory/);
});

async function engines(receiptTimeout=100){
 const bus=new MemorySignalBus(),peers=new Map<string,FakePeer>(),received:string[]=[],states=new Map<string,string>();
 const make=(source:string,destination:string)=>new ClipboardPeer({local:source,remote:destination,receiptTimeout,signaling:bus.endpoint(source,destination),configuration:async()=>({}),onState:value=>states.set(source,value),onClipboard:message=>{received.push(message.text);},createPeer:()=>{const engine=new FakePeer();peers.set(source,engine);return engine as unknown as RTCPeerConnection;}});
 const first=make(local,remote),second=make(remote,local);await Promise.all([first.start(),second.start()]);await waitFor(()=>states.get(local)==='connected'&&states.get(remote)==='connected');
 return{first,second,bus,peers,received,stop:()=>Promise.all([first.stop(),second.stop()])};
}

test('lost receipt retries the same ID across a rebuilt channel and applies clipboard once',async()=>{
 const setup=await engines();try{
  const receiver=setup.peers.get(remote)!.channel!,send=receiver.send.bind(receiver);let dropped=false;
  receiver.send=value=>{if(JSON.parse(value).type==='ack'&&!dropped){dropped=true;return;}send(value);};
  const queued=await setup.first.enqueue('One reliable transfer');await waitFor(()=>setup.first.ledger.size===0,7000);await queued.delivered;
  assert.equal(setup.received.filter(value=>value==='One reliable transfer').length,1);assert(dropped);
 }finally{await setup.stop();}
});

test('rapid copies during an outage all queue and automatically drain after recovery',async()=>{
 const setup=await engines(1000);try{
  const engine=setup.peers.get(local);setup.bus.available.get(local)!(false);
  const queued=await Promise.all(Array.from({length:20},(_,index)=>setup.first.enqueue('Offline copy '+index,'page-copy')));
  assert.equal(setup.first.ledger.size,20);assert.equal(setup.received.length,0);
  setup.bus.available.get(local)!(true);await Promise.all(queued.map(item=>item.delivered));assert.equal(setup.first.ledger.size,0);assert.equal(setup.received.length,20);assert.equal(setup.received.at(-1),'Offline copy 19');assert.equal(setup.peers.get(local),engine);
 }finally{await setup.stop();}
});

async function service(){
 const origin='http://localhost:3000',server=createSignalingService({origins:[origin],serviceId:'test'});await new Promise<void>(resolve=>server.server.listen(0,'127.0.0.1',resolve));
 const address=server.server.address();if(!address||typeof address==='string')throw new Error('No service port');
 const endpoint='ws://127.0.0.1:'+address.port+'/signal',factory=(url:string)=>new WebSocket(url,{origin}) as unknown as globalThis.WebSocket;
 return{server,endpoint,factory,origin};
}

test('approved capability resumes after helper reload without a fresh QR; revocation clears recovery',async()=>{
 const setup=await service(),storage=memory(),host=new GuestClient(setup.endpoint,'test',setup.factory),phone=new GuestClient(setup.endpoint,'test',setup.factory,storage);let resumed:GuestClient|undefined;
 try{
  await host.create('Resume PC');await phone.join({code:host.getSnapshot().code},'Resume phone');await host.confirm();await waitFor(()=>phone.getSnapshot().session?.status==='approved');
  await waitFor(()=>Boolean(phone.getSnapshot().online));await new Promise(resolve=>setTimeout(resolve,10));const device=phone.getSnapshot().session!.deviceId;phone.close();
  resumed=new GuestClient(setup.endpoint,'test',setup.factory,storage);assert.equal(await resumed.resume(),true);assert.equal(resumed.getSnapshot().session?.deviceId,device);assert.equal(resumed.getSnapshot().session?.status,'approved');assert.equal(resumed.getSnapshot().qr,null);
  await resumed.revoke();assert.equal(await storage.load(),null);
 }finally{host.close();phone.close();resumed?.close();await setup.server.close();}
});

test('automatic WebSocket retry continues beyond eight failures without manual reconnect',async()=>{
 const setup=await service();let attempts=0,failures=0;
 const client=new GuestClient(setup.endpoint,'test',url=>{attempts++;return new WebSocket(url,{origin:failures-->0?'https://rejected.example':setup.origin}) as unknown as globalThis.WebSocket;},undefined,{retryDelay:()=>5});
 try{await client.create('Retry PC');failures=11;client.networkLost();await waitFor(()=>attempts>=13&&client.getSnapshot().online,5000);assert.equal(client.getSnapshot().session?.status,'waiting');await client.revoke();}
 finally{client.close();await setup.server.close();}
});

test('a half-open socket is detected by a timed request and automatically replaced',async()=>{
 const setup=await service();let drop=false,attempts=0;
 const client=new GuestClient(setup.endpoint,'test',url=>{attempts++;const socket=new WebSocket(url,{origin:setup.origin}),send=socket.send.bind(socket);socket.send=((...args:Parameters<typeof socket.send>)=>{if(!drop||attempts>1)send(...args);}) as typeof socket.send;return socket as unknown as globalThis.WebSocket;},undefined,{requestTimeout:80,retryDelay:()=>5});
 try{await client.create('Half-open PC');drop=true;await assert.rejects(client.recover(),/timed out/);await waitFor(()=>attempts>=2&&client.getSnapshot().online);await client.revoke();}
 finally{client.close();await setup.server.close();}
});
