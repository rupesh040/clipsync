import {z} from 'zod';
import {credentialsSchema,pairingSchema,sessionSchema,signalingUrl,type Credentials,type PairSession,type PairingQr} from './protocol';
import {signalSchema,type Signal} from '../transport/signals';
import {reconnectDelay} from '../protocol';

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
 constructor(readonly endpoint:string,readonly serviceId:string,private factory=(url:string)=>new WebSocket(url)){}
 getSnapshot=()=>this.snapshot;
 getServerSnapshot=()=>initial;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 onSignal=(listener:(signal:Signal)=>void)=>{this.signals.add(listener);return()=>{this.signals.delete(listener);};};
 private update(value:Partial<PairSnapshot>){this.snapshot={...this.snapshot,...value};for(const listener of this.listeners)listener();}
 private async connect(){
  if(this.socket?.readyState===1)return;
  if(this.opening)return this.opening;
  const endpoint=signalingUrl(this.endpoint);if(!endpoint)throw new Error('Set NEXT_PUBLIC_SIGNALING_URL to your deployed WSS service. No login is required.');
  this.stopped=false;
  this.opening=new Promise<void>((resolve,reject)=>{
   const socket=this.factory(endpoint);this.socket=socket;let opened=false;
   const timeout=setTimeout(()=>{socket.close();reject(new Error('Signaling connection timed out.'));},10_000);
   socket.onmessage=event=>{if(this.socket===socket)this.receive(event.data);};
   socket.onopen=()=>{opened=true;clearTimeout(timeout);resolve();};
   socket.onerror=()=>{clearTimeout(timeout);reject(new Error('Signaling is unavailable. Check the endpoint and allowed origin.'));};
   socket.onclose=event=>{
    clearTimeout(timeout);if(this.socket!==socket)return;this.socket=null;this.attachedSocket=null;this.update({online:false});
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('Signaling disconnected.'));}this.pending.clear();
    if(!opened)reject(new Error('Signaling connection was rejected. Check the origin allowlist.'));
    if(event.code===4403||event.code===4409){this.credentials=null;this.update({qr:null,code:'',error:event.code===4409?'Session opened elsewhere. Pair again.':'Session expired or revoked. Pair again.',session:this.snapshot.session?{...this.snapshot.session,status:event.code===4409?'revoked':'expired'}:null});return;}
    if(!this.stopped&&this.credentials&&this.attempt<8){this.retry=setTimeout(()=>{void this.reattach().catch(()=>{this.socket?.close();});},reconnectDelay(this.attempt++));}
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
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Signaling request timed out.'));},10_000);
   this.pending.set(id,{resolve,reject,timer});
   try{this.socket!.send(JSON.stringify({id,op,...values,...(authorized?{auth}:{})}));}catch{clearTimeout(timer);this.pending.delete(id);reject(new Error('Signaling is disconnected.'));}
  });
 }
 private accept(raw:unknown){const value=setupSchema.parse(raw);this.credentials=value.credentials;this.attachedSocket=this.socket;this.attempt=0;this.update({session:value.session,qr:value.qr||null,code:value.code||'',online:true,error:''});}
 async create(name:string){await this.reset();this.accept(await this.request('create',{name},false));}
 async inspect(proof:PairProof):Promise<PairPreview>{return z.object({sessionId:z.uuid(),deviceName:z.string().max(60),expiresAt:z.number(),serviceId:z.string()}).strict().parse(await this.request('inspect',{proof},false));}
 async join(proof:PairProof,name:string){if(this.credentials)throw new Error('Disconnect the current session before joining another.');this.accept(await this.request('join',{proof,name},false));}
 async confirm(){const result=await this.request('confirm');this.update({session:sessionSchema.parse((result as {session:unknown}).session),qr:null,code:''});}
 async revoke(){if(this.credentials)await this.request('revoke');this.close();this.update({session:null,qr:null,code:'',online:false,error:''});}
 async reset(){if(this.credentials)await this.revoke();else this.close();}
 async reconnect(){if(!this.credentials)throw new Error('This session is no longer available. Pair again.');await this.reattach();}
 close(){this.stopped=true;clearTimeout(this.retry);this.socket?.close();this.socket=null;this.attachedSocket=null;this.credentials=null;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('Session closed.'));}this.pending.clear();this.update({online:false,session:null,qr:null,code:''});}
}
