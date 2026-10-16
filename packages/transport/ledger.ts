import {z} from 'zod';
import {clipboardMessageSchema,MAX_MESSAGE_AGE,type ClipboardMessage,type MessageOrigin,textSchema} from '../protocol';

export type RecoveryStorage={load:()=>Promise<unknown>;save:(value:unknown)=>Promise<void>};
const stampSchema=z.object({timestamp:z.number().int().positive(),sequence:z.number().int().nonnegative(),source:z.uuid(),id:z.uuid()}).strict();
type Stamp=z.infer<typeof stampSchema>;
const savedSchema=z.object({version:z.literal(1),local:z.uuid(),remote:z.uuid(),expiresAt:z.number(),latest:stampSchema.nullable(),outbound:z.array(clipboardMessageSchema).max(32)}).strict();
type Saved=z.infer<typeof savedSchema>;
function stamp(message:ClipboardMessage):Stamp{return{timestamp:message.timestamp,sequence:message.sequence||0,source:message.source,id:message.id};}
function compare(first:Stamp,second:Stamp){return first.timestamp-second.timestamp||first.sequence-second.sequence||first.source.localeCompare(second.source)||first.id.localeCompare(second.id);}

export class TransferLedger{
 private saved:Saved;
 private work:Promise<unknown>=Promise.resolve();
 storageError='';
 readonly ready:Promise<void>;
 constructor(readonly local:string,readonly remote:string,private storage?:RecoveryStorage,expiresAt=Number.MAX_SAFE_INTEGER){
  this.saved={version:1,local,remote,expiresAt,latest:null,outbound:[]};
  this.ready=this.restore().catch(()=>{this.storageError='Local recovery storage is unavailable. Receiving continues in memory.';});
 }
 private async restore(){
  if(!this.storage)return;
  const result=savedSchema.safeParse(await this.storage.load());
  if(result.success&&result.data.local===this.local&&result.data.remote===this.remote&&result.data.expiresAt>Date.now()){
   this.saved={...result.data,expiresAt:Math.min(this.saved.expiresAt,result.data.expiresAt),outbound:result.data.outbound.filter(message=>message.source===this.local&&message.destination===this.remote&&Date.now()-message.timestamp<MAX_MESSAGE_AGE&&message.timestamp<=Date.now()+30_000)};
  }
 }
 private update<Result>(action:()=>Promise<Result>|Result):Promise<Result>{
  const result=this.work.then(()=>this.ready).then(action);this.work=result.catch(()=>{});return result;
 }
 private async commit(next:Saved,durable=true){try{await this.storage?.save(next);this.storageError='';}catch(error){this.storageError='Local recovery storage is unavailable. Receiving continues in memory; reload recovery is not guaranteed.';if(durable)throw error;}this.saved=next;}
 get size(){return this.saved.outbound.length;}
 get expiresAt(){return this.saved.expiresAt;}
 entries(){return this.saved.outbound.slice();}
 async add(text:string,origin:MessageOrigin){
  textSchema.parse(text);const captured=Date.now();
  return this.update(async()=>{
   if(this.saved.expiresAt<=Date.now())throw new Error('Pairing expired. Pending text was not sent.');
   if(this.saved.outbound.length>=32||this.saved.outbound.reduce((bytes,message)=>bytes+new TextEncoder().encode(message.text).byteLength,0)+new TextEncoder().encode(text).byteLength>262_144)throw new Error('The local queue is full (32 updates / 256 KiB). Reconnect before copying more text.');
   const previous=this.saved.latest,timestamp=Math.max(captured,previous?.timestamp||0),sequence=previous?.timestamp===timestamp?previous.sequence+1:0;
   const message:ClipboardMessage={version:1,type:'clipboard',id:crypto.randomUUID(),source:this.local,destination:this.remote,session:crypto.randomUUID(),timestamp,sequence,text,origin};
   await this.commit({...this.saved,latest:stamp(message),outbound:[...this.saved.outbound,message]});return message;
  });
 }
 acknowledge(id:string){return this.update(async()=>{await this.commit({...this.saved,outbound:this.saved.outbound.filter(message=>message.id!==id)});});}
 accept(message:ClipboardMessage,apply:()=>void|Promise<void>){
  return this.update(async()=>{
   if(this.saved.latest&&compare(stamp(message),this.saved.latest)<=0)return false;
   await apply();await this.commit({...this.saved,latest:stamp(message)},false);return true;
  });
 }
 clear(){return this.update(()=>this.commit({...this.saved,latest:null,outbound:[],expiresAt:0}));}
}
