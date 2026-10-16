import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {waitFor} from './helpers/memory-signaling';
const worker=buildSync({entryPoints:['extension/src/background.ts'],bundle:true,write:false,format:'iife',define:{__APP_ORIGIN__:'"https://clipsync-orcin.vercel.app"'}}).outputFiles[0].text;

function environment(){
 const data:Record<string,unknown>={},events:Record<string,(value?:unknown)=>void>={};let helper=false,created=0,alarms=0;
 const signal=(name:string)=>({addListener:(listener:(value?:unknown)=>void)=>{events[name]=listener;}});
 const chrome={runtime:{id:'clipsync-test',getURL:(path:string)=>'chrome-extension://clipsync-test/'+path,ContextType:{OFFSCREEN_DOCUMENT:'OFFSCREEN_DOCUMENT'},getContexts:async()=>helper?[{}]:[],onMessage:signal('message'),onStartup:signal('startup'),onInstalled:signal('installed'),sendMessage:async()=>({ok:true})},offscreen:{Reason:{CLIPBOARD:'CLIPBOARD',WEB_RTC:'WEB_RTC'},createDocument:async()=>{helper=true;created++;}},storage:{local:{get:async()=>({})},session:{get:async(key:string)=>({[key]:data[key]}),set:async(value:Record<string,unknown>)=>{Object.assign(data,value);},remove:async(key:string)=>{delete data[key];}}},permissions:{getAll:async()=>({origins:[]}),onAdded:signal('added'),onRemoved:signal('removed')},scripting:{unregisterContentScripts:async()=>{},registerContentScripts:async()=>{}},alarms:{create:async()=>{alarms++;},onAlarm:signal('alarm')}};
 runInNewContext(worker,{chrome,URL,Date,console});
 const request=(action:string,sender:unknown,values:Record<string,unknown>={})=>new Promise<{ok:boolean;value?:unknown}>(resolve=>{(events.message as unknown as (message:unknown,sender:unknown,respond:typeof resolve)=>void)({target:'worker',action,...values},sender,resolve);});
 return{data,events,request,get created(){return created;},get alarms(){return alarms;},removeHelper:()=>{helper=false;}};
}

test('MV3 alarm recreates an absent helper only for an unexpired saved pairing',async()=>{
 const setup=environment();setup.data['recovery:pair']={session:{expiresAt:Date.now()+60_000}};
 setup.events.installed();await waitFor(()=>setup.created===1&&setup.alarms===1);setup.removeHelper();setup.events.alarm({name:'clipsync-recovery'});await waitFor(()=>setup.created===2);
 setup.removeHelper();setup.data['recovery:pair']={session:{expiresAt:Date.now()-1}};setup.events.alarm({name:'clipsync-recovery'});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(setup.created,2);
});

test('extension recovery credentials are isolated from content scripts and popup pages',async()=>{
 const setup=environment(),helper={id:'clipsync-test',url:'chrome-extension://clipsync-test/offscreen.html'};
 assert.equal((await setup.request('recoverySet',helper,{key:'recovery:pair',value:{test:'session-only'}})).ok,true);
 for(const sender of [{id:'clipsync-test',url:'https://example.com',tab:{id:1}},{id:'clipsync-test',url:'chrome-extension://clipsync-test/popup.html'},{id:'other',url:helper.url}])assert.equal((await setup.request('recoveryGet',sender,{key:'recovery:pair'})).ok,false);
 assert.equal((await setup.request('recoveryGet',helper,{key:'recovery:pair'})).ok,true);await setup.request('recoverySet',helper,{key:'recovery:pair',value:null});assert.equal(setup.data['recovery:pair'],undefined);
});

test('automatic copy observation preserves text, excludes password/cancelled copies, and removes listeners',async()=>{
 const bundle=buildSync({entryPoints:['lib/copy-events.ts'],bundle:true,write:false,format:'iife',globalName:'copyModule'}).outputFiles[0].text;
 class Input{type='text';value='';selectionStart=0;selectionEnd=0;}
 class TextArea extends Input{}
 const context:{copyModule?:{observeCopies:(document:unknown,receive:(text:string)=>void)=>()=>void}}={};
 runInNewContext(bundle,Object.assign(context,{HTMLInputElement:Input,HTMLTextAreaElement:TextArea,queueMicrotask,TextEncoder}));
 let handler:((event:unknown)=>void)|undefined;const received:string[]=[];
 const document={addEventListener:(_name:string,callback:typeof handler)=>{handler=callback;},removeEventListener:()=>{handler=undefined;},getSelection:()=>({toString:()=> 'Original\ntext 🙂'})};
 const stop=context.copyModule!.observeCopies(document,text=>received.push(text));handler!({target:{},defaultPrevented:false});await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(received,['Original\ntext 🙂']);
 const password=new Input();password.type='password';password.value='secret';password.selectionEnd=6;handler!({target:password,defaultPrevented:false});handler!({target:{},defaultPrevented:true});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(received.length,1);
 handler!({target:{},defaultPrevented:true,clipboardData:{getData:()=> 'Custom copy'}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(received.at(-1),'Custom copy');stop();assert.equal(handler,undefined);
});
