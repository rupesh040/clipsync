import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalClipboardStore} from '../lib/local-clipboard';
import type {ClipboardMessage} from '../packages/protocol';
import {turnCredentials,allowedRtcOrigin} from '../lib/rtc-credentials';

function storage(){const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);},clear:()=>values.clear(),key:(index:number)=>[...values.keys()][index]||null,get length(){return values.size;}};}
const sample=():ClipboardMessage=>({version:1,id:crypto.randomUUID(),source:crypto.randomUUID(),destination:crypto.randomUUID(),session:crypto.randomUUID(),timestamp:Date.now(),type:'clipboard',text:'Sensitive test-only text\nline two',origin:'page-copy'});
test('receiving updates subscribers immediately without persisting text by default',()=>{
  const disk=storage();const store=new LocalClipboardStore('test',disk);let updates=0;const unsubscribe=store.subscribe(()=>{updates++;});const value=sample();store.receive(value,'My PC');
  assert.equal(store.getSnapshot().latest?.content,value.text);assert(updates>=2);assert.equal(disk.getItem('test')?.includes(value.text),false);assert.equal(store.getSnapshot().items.length,0);unsubscribe();
});
test('opt-in history persists locally, preserves text, and deletes it on disable',()=>{
  const disk=storage();const store=new LocalClipboardStore('test',disk);store.subscribe(()=>{});store.preferences(true,7);const value=sample();store.receive(value,'My PC');
  assert.equal(JSON.parse(disk.getItem('test')!).items[0].content,value.text);store.preferences(false,7);assert.equal(JSON.parse(disk.getItem('test')!).items.length,0);assert.equal(store.getSnapshot().latest?.content,value.text);
  store.mutate('clear');assert.equal(store.getSnapshot().latest,null);
});
test('TURN credentials expire and CORS accepts only exact configured origins',()=>{
  const value=turnCredentials('test-only-secret','user','device',600,1_000_000);assert(value.username.startsWith('1600:'));assert.equal(value.expiresAt,1600);assert.notEqual(value.credential,'test-only-secret');
  const extension='chrome-extension://'+'a'.repeat(32);assert(allowedRtcOrigin(extension,'https://app.example',undefined,extension));assert.equal(allowedRtcOrigin('https://evil.example','https://app.example',undefined,extension),false);assert.equal(allowedRtcOrigin(null,'https://app.example',undefined,extension),false);
});

test('storage failure never blocks incoming text or its React subscriber',()=>{
  const disk=storage();disk.setItem=()=>{throw new Error('QuotaExceededError');};
  const store=new LocalClipboardStore('blocked',disk);let updates=0;store.subscribe(()=>{updates++;});
  const value=sample();assert.doesNotThrow(()=>store.receive(value,'PC'));
  assert.equal(store.getSnapshot().latest?.content,value.text);assert(updates>=2);assert.match(store.getSnapshot().storageError||'',/Receiving continues in memory/);
  assert.throws(()=>store.preferences(true,7),/storage is unavailable/);
});
