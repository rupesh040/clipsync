import {z} from 'zod';
import {credentialsSchema,pairingSchema,sessionSchema,signalingUrl,type Credentials,type PairSession,type PairingQr} from './protocol';
import {signalSchema,type Signal} from '../transport/signals';
import {reconnectDelay} from '../protocol';
import {resumeSchema} from './persistence';
import type {RecoveryStorage} from '../transport/ledger';

export type PairSnapshot={session:PairSession|null;qr:PairingQr|null;code:string;online:boolean;error:string};
const initial:PairSnapshot={session:null,qr:null,code:'',online:false,error:''};
export function shouldRecoverSession(snapshot:PairSnapshot){return snapshot.session?.status==='approved'&&!snapshot.online;}
const setupSchema=z.object({credentials:credentialsSchema,session:sessionSchema,qr:pairingSchema.optional(),code:z.string().optional()});
export type PairProof={sessionId:string;secret:string}|{code:string};
export type PairPreview={sessionId:string;deviceName:string;expiresAt:number;serviceId:string};
export class GuestClient{
 private socket:WebSocket|null=null;
 private opening:Promise<void>|null=null;
 private attachedSocket:WebSocket|null=null;
 private attaching:Promise<void>|null=null;
 private credentials:Credentials|null=null;
 private snapshot:PairSnapshot=initial;
 private listeners=new Set<()=>void>();
 private signals=new Set<(signal:Signal)=>void>();
 private pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private retry?:ReturnType<typeof setTimeout>;
 private stopped=false;
 private attempt=0;
 private initialized:Promise<void>|null=null;
 private saving:Promise<void>=Promise.resolve();
 private heartbeat?:ReturnType<typeof setInterval>;
 private recovering:Promise<void>|null=null;
 private lifecycle=0;
 private recoveryBlocked=false;
 constructor(readonly endpoint:string,readonly serviceId:string,private factory=(url:string)=>new WebSocket(url),private persistence?:RecoveryStorage,private timing:{retryDelay?:(attempt:number)=>number;requestTimeout?:number}={}){}
 getSnapshot=()=>this.snapshot;
 getServerSnapshot=()=>initial;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 onSignal=(listener:(signal:Signal)=>void)=>{this.signals.add(listener);return()=>{this.signals.delete(listener);};};
 private update(value:Partial<PairSnapshot>){this.snapshot={...this.snapshot,...value};for(const listener of this.listeners)listener();if(value.session!==undefined)void this.save();}
 private initialize(){
  const lifecycle=this.lifecycle;
  if(!this.initialized)this.initialized=(async()=>{
   if(!this.persistence)return;
   const result=resumeSchema.safeParse(await this.persistence.load());if(lifecycle!==this.lifecycle)return;
   if(result.success&&result.data.endpoint===this.endpoint&&result.data.serviceId===this.serviceId&&result.data.session.status==='approved'&&result.data.session.expiresAt>Date.now()&&result.data.credentials.sessionId===result.data.session.sessionId&&result.data.credentials.deviceId===result.data.session.deviceId){this.credentials=result.data.credentials;this.update({session:result.data.session,online:false,error:''});}
   else await this.persistence.save(null);
  })().catch(()=>{this.update({error:'Session recovery storage is unavailable. This connection can continue in memory.'});});
  return this.initialized;
 }
 private save(){
  if(!this.persistence)return Promise.resolve();
  const session=this.snapshot.session,value=!this.recoveryBlocked&&this.credentials&&session?.status==='approved'?{endpoint:this.endpoint,serviceId:this.serviceId,credentials:{...this.credentials,expiresAt:session.expiresAt},session}:null;
  this.saving=this.saving.then(()=>this.persistence!.save(value)).catch(()=>{this.update({error:'Session recovery could not be saved. Keep this app open.'});});return this.saving;
 }
 private schedule(){
  clearTimeout(this.retry);
  if(this.stopped||!this.credentials)return;
  this.retry=setTimeout(()=>{void this.reattach().catch(()=>{this.drop();this.schedule();});},(this.timing.retryDelay||reconnectDelay)(this.attempt++));
 }
 private drop(){
  const socket=this.socket;this.socket=null;this.attachedSocket=null;this.opening=null;socket?.close();
  for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('Signaling disconnected.'));}this.pending.clear();this.update({online:false});
 }
 private async connect(){
  const lifecycle=this.lifecycle;await this.initialize();if(lifecycle!==this.lifecycle)throw new Error('Connection stopped.');
  if(this.socket?.readyState===1)return;
  if(this.opening)return this.opening;
  const endpoint=signalingUrl(this.endpoint);if(!endpoint)throw new Error('Set NEXT_PUBLIC_SIGNALING_URL to your deployed WSS service. No login is required.');
  this.stopped=false;
  this.opening=new Promise<void>((resolve,reject)=>{
   const socket=this.factory(endpoint);this.socket=socket;let opened=false;
   const timeout=setTimeout(()=>{socket.close();reject(new Error('Signaling connection timed out.'));},this.timing.requestTimeout||10_000);
   socket.onmessage=event=>{if(this.socket===socket)this.receive(event.data);};
   socket.onopen=()=>{if(this.socket!==socket){socket.close();reject(new Error('Connection superseded.'));return;}opened=true;clearTimeout(timeout);clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>{if(this.snapshot.session?.status==='approved')void this.recover().catch(()=>{});},20_000);resolve();};
   socket.onerror=()=>{clearTimeout(timeout);reject(new Error('Signaling is unavailable. Check the endpoint and allowed origin.'));};
   socket.onclose=event=>{
    clearTimeout(timeout);if(this.socket!==socket)return;this.socket=null;this.attachedSocket=null;this.update({online:false});
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('Signaling disconnected.'));}this.pending.clear();
    if(!opened)reject(new Error('Signaling connection was rejected. Check the origin allowlist.'));
    if(event.code===4403||event.code===4409){this.credentials=null;clearInterval(this.heartbeat);this.update({qr:null,code:'',error:event.code===4409?'Session opened elsewhere. Pair again.':'Session expired or revoked. Pair again.',session:this.snapshot.session?{...this.snapshot.session,status:event.code===4409?'revoked':'expired'}:null});return;}
    this.schedule();
   };
  }).finally(()=>{this.opening=null;});
  return this.opening;
 }
 private async attachCurrent(){
  if(this.attachedSocket===this.socket&&this.snapshot.online)return;
  if(this.attaching)return this.attaching;
  const socket=this.socket;
  this.attaching=(async()=>{const value=await this.request('attach',{},true);if(this.socket!==socket||!this.credentials)throw new Error('Connection superseded. Retry.');this.attachedSocket=socket;this.attempt=0;this.update({session:sessionSchema.parse((value as {session:unknown}).session),online:true,error:''});})().finally(()=>{this.attaching=null;});
  return this.attaching;
 }
 private async reattach(){await this.connect();if(this.credentials)await this.attachCurrent();}
 async resume(){const lifecycle=this.lifecycle;await this.initialize();if(lifecycle!==this.lifecycle||!this.credentials)return false;await this.reattach();return true;}
 recover():Promise<void>{
  if(this.recovering)return this.recovering;
  this.recovering=(async()=>{
   await this.initialize();if(!this.credentials)return;
   if(this.snapshot.session&&this.snapshot.session.expiresAt<=Date.now()){this.credentials=null;this.update({session:{...this.snapshot.session,status:'expired'},online:false,error:'Session expired. Pair again.'});this.drop();return;}
   try{await this.request('authorize');}catch(error){if(this.credentials){this.drop();this.schedule();}throw error;}
  })().finally(()=>{this.recovering=null;});return this.recovering;
 }
 networkLost(){if(!this.credentials)return;this.drop();this.schedule();}
 async forgetRecovery(){this.recoveryBlocked=true;await this.saving;await this.persistence?.save(null);}
 private receive(raw:unknown){
  try{
   if(typeof raw!=='string'||raw.length>80_000)return;
   const value=JSON.parse(raw);
   if(value.event==='state'){
    const session=sessionSchema.parse(value.session);if(session.sessionId!==this.credentials?.sessionId)return;
    this.update({session,qr:session.status==='waiting'?this.snapshot.qr:null,code:session.status==='waiting'?this.snapshot.code:''});
    if(['revoked','expired'].includes(session.status)){this.credentials=null;this.update({online:false,error:'Session ended. Pair again.'});}
   }else if(value.event==='signal'){const parsed=signalSchema.safeParse(value.signal);if(parsed.success&&parsed.data.to_device===this.credentials?.deviceId)for(const listener of this.signals)listener(parsed.data);}
   else if(value.event==='ended'){this.credentials=null;this.update({online:false,qr:null,code:'',session:this.snapshot.session?{...this.snapshot.session,status:'expired'}:null,error:'Session expired or revoked. Pair again.'});}
   else if(typeof value.id==='string'){
    const pending=this.pending.get(value.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(value.id);
    if(value.ok===true)pending.resolve(value.result);else{
     if(value.code==='SESSION_ENDED'){this.credentials=null;this.update({online:false,qr:null,code:'',session:this.snapshot.session?{...this.snapshot.session,status:'expired'}:null,error:'Session expired or revoked. Pair again.'});this.socket?.close();}
     pending.reject(new Error(typeof value.error==='string'?value.error:'Request rejected.'));
    }
   }
  }catch{this.update({error:'Invalid signaling response rejected.'});}
 }
 async request(op:string,values:Record<string,unknown>={},authorized=true):Promise<unknown>{
  await this.connect();if(authorized&&!this.credentials)throw new Error('Pair this device first.');
  if(authorized&&op!=='attach')await this.attachCurrent();
  const id=crypto.randomUUID(),auth=this.credentials?{sessionId:this.credentials.sessionId,token:this.credentials.token}:undefined;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Signaling request timed out.'));},this.timing.requestTimeout||10_000);
   this.pending.set(id,{resolve,reject,timer});
   try{this.socket!.send(JSON.stringify({id,op,...values,...(authorized?{auth}:{})}));}catch{clearTimeout(timer);this.pending.delete(id);reject(new Error('Signaling is disconnected.'));}
  });
 }
 private accept(raw:unknown){const value=setupSchema.parse(raw);this.credentials=value.credentials;this.attachedSocket=this.socket;this.attempt=0;this.update({session:value.session,qr:value.qr||null,code:value.code||'',online:true,error:''});}
 async create(name:string){await this.initialize();await this.reset();this.recoveryBlocked=false;this.accept(await this.request('create',{name},false));}
 async inspect(proof:PairProof):Promise<PairPreview>{return z.object({sessionId:z.uuid(),deviceName:z.string().max(60),expiresAt:z.number(),serviceId:z.string()}).strict().parse(await this.request('inspect',{proof},false));}
 async join(proof:PairProof,name:string){await this.initialize();if(this.credentials)throw new Error('Disconnect the current session before joining another.');this.recoveryBlocked=false;this.accept(await this.request('join',{proof,name},false));}
 async confirm(){const result=await this.request('confirm');this.update({session:sessionSchema.parse((result as {session:unknown}).session),qr:null,code:''});await this.save();}
 async revoke(){if(this.credentials)await this.request('revoke');this.close();this.update({session:null,qr:null,code:'',online:false,error:''});await this.save();}
 async reset(){if(this.credentials)await this.revoke();else this.close();}
 async reconnect(){if(!this.credentials)throw new Error('This session is no longer available. Pair again.');await this.reattach();}
 close(){this.lifecycle++;this.stopped=true;clearTimeout(this.retry);clearInterval(this.heartbeat);this.drop();this.credentials=null;this.snapshot={...initial};this.initialized=null;for(const listener of this.listeners)listener();}
}
