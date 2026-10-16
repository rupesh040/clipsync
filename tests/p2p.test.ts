import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ClipboardPeer} from '../packages/transport/peer';
import {decodeMessage,encodeMessage,EchoGuard,MAX_TEXT_BYTES,RecentIds,reconnectDelay,type ClipboardMessage} from '../packages/protocol';
import {MemorySignalBus,waitFor} from './helpers/memory-signaling';
import {FakePeer} from './helpers/fake-rtc';

export const firstId='11111111-1111-4111-8111-111111111111';
export const secondId='22222222-2222-4222-8222-222222222222';
function message():ClipboardMessage{return{version:1,id:crypto.randomUUID(),source:firstId,destination:secondId,session:crypto.randomUUID(),timestamp:Date.now(),type:'clipboard',text:'  Original\nline breaks 🙂  ',origin:'page-copy'};}
test('protocol preserves original text and rejects oversized UTF-8, malformed, stale, and misrouted messages',()=>{
  const value=message();assert.equal(decodeMessage(encodeMessage(value),secondId,firstId,value.session).type,'clipboard');
  assert.throws(()=>encodeMessage({...value,text:'🙂'.repeat(MAX_TEXT_BYTES)}));
  for(const raw of ['{','[]',JSON.stringify({...value,text:'',extra:'data'}),JSON.stringify({...value,source:secondId}),JSON.stringify({...value,timestamp:Date.now()-7_200_001}),JSON.stringify({...value,destination:firstId})])assert.throws(()=>decodeMessage(raw,secondId,firstId,value.session));
});
test('bounded deduplication expires old IDs and echo guard suppresses remotely written values',async()=>{
  const ids=new RecentIds(2,100);ids.add('one',0);ids.add('two',1);ids.add('three',2);assert.equal(ids.has('one',3),false);assert.equal(ids.has('three',103),false);
  const echo=new EchoGuard();await echo.received('private sample');assert.equal(await echo.shouldSend('private sample'),false);assert.equal(await echo.shouldSend('new sample'),true);assert.equal(await echo.shouldSend('new sample'),false);
  assert.equal(await echo.shouldSend('private sample'),true);
  assert.equal(reconnectDelay(0,()=>0),600);assert(reconnectDelay(99,()=>1)<=36000);
});

async function pair(){
  const bus=new MemorySignalBus();const received:ClipboardMessage[]=[];const reverse:ClipboardMessage[]=[];const states=new Map<string,string>();const engines=new Map<string,FakePeer>();
  const make=(local:string,remote:string,onClipboard:(message:ClipboardMessage)=>void)=>new ClipboardPeer({local,remote,signaling:bus.endpoint(local,remote),configuration:async()=>({iceServers:[]}),onClipboard,onState:state=>states.set(local,state),createPeer:()=>{const engine=new FakePeer();engines.set(local,engine);return engine as unknown as RTCPeerConnection;}});
  const first=make(firstId,secondId,value=>{reverse.push(value);});const second=make(secondId,firstId,value=>{received.push(value);});
  await Promise.all([first.start(),second.start()]);await waitFor(()=>states.get(firstId)==='connected'&&states.get(secondId)==='connected');
  return{bus,first,second,received,reverse,states,engines,stop:async()=>{await Promise.all([first.stop(),second.stop()]);}};
}
test('DataChannel manager delivers in both directions and ignores duplicates, malformed data, and echo envelopes',async()=>{
  const setup=await pair();try{
    await setup.first.send('Line one\nLine two 🙂','page-copy');assert.equal(setup.received[0].text,'Line one\nLine two 🙂');
    const first=setup.engines.get(firstId)!.channel!;const second=setup.engines.get(secondId)!.channel!;
    const raw=first.sent.find(value=>JSON.parse(value).type==='clipboard')!;
    second.receive(raw);second.receive('{bad');second.receive(JSON.stringify({...JSON.parse(raw),source:secondId}));
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(setup.received.length,1);
    await setup.second.send('Reverse text','user-read');assert.equal(setup.reverse[0].text,'Reverse text');
  }finally{await setup.stop();}
});
test('temporary signaling loss retains the healthy peer and queues updates until authorization returns',async()=>{
  const setup=await pair();try{
    const engine=setup.engines.get(firstId);setup.bus.available.get(firstId)!(false);const queued=await setup.first.enqueue('Queued while offline');assert.equal(setup.first.ledger.size,1);assert.equal(setup.received.length,0);
    setup.bus.available.get(firstId)!(true);await queued.delivered;assert.equal(setup.engines.get(firstId),engine);assert.equal(setup.received[0].text,'Queued while offline');assert.equal(setup.first.ledger.size,0);
  }finally{await setup.stop();}
});
test('revocation rejects further sends and tears down the peer',async()=>{
  const setup=await pair();try{setup.bus.allowed=false;setup.bus.revoked.get(firstId)!();await assert.rejects(setup.first.send('No delivery'));assert.equal(setup.states.get(firstId),'disconnected');assert.equal(setup.received.length,0);}finally{await setup.stop();}
});

test('stopping during authorization cannot create a late signaling listener',async()=>{
  let resolveAuthorization:(allowed:boolean)=>void=()=>{};let starts=0;
  const authorization=new Promise<boolean>(resolve=>{resolveAuthorization=resolve;});
  const peer=new ClipboardPeer({local:firstId,remote:secondId,configuration:async()=>({}),onClipboard:()=>{},onState:()=>{},signaling:{
    authorize:()=>authorization,start:async()=>{starts++;},send:async()=>{},stop:async()=>{},
  }});
  const starting=peer.start();await peer.stop();resolveAuthorization(true);await starting;assert.equal(starts,0);
});

test('stopping during signaling setup closes a late-created subscription',async()=>{
  let finishSetup:()=>void=()=>{};let subscriptions=0;let entered=false;
  const setup=new Promise<void>(resolve=>{finishSetup=resolve;});
  const peer=new ClipboardPeer({local:firstId,remote:secondId,configuration:async()=>({}),onClipboard:()=>{},onState:()=>{},signaling:{
    authorize:async()=>true,start:async()=>{entered=true;await setup;subscriptions++;},send:async()=>{},stop:async()=>{subscriptions=0;},
  }});
  const starting=peer.start();await waitFor(()=>entered);await peer.stop();finishSetup();await starting;assert.equal(subscriptions,0);
});
