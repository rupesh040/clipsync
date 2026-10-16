import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Credentials,PairSession,PairingQr} from '../packages/pairing/protocol';

type Device={id:string;name:string;hash:Buffer};
type Room={id:string;secret:Buffer;code:Buffer;host:Device;phone?:Device;status:PairSession['status'];pairExpiry:number;expires:number;verification:string};
const digest=(value:string)=>createHash('sha256').update(value).digest();
const equal=(hash:Buffer,value:string)=>timingSafeEqual(hash,digest(value));
const token=()=>randomBytes(32).toString('base64url');
export class PairingStore{
 private rooms=new Map<string,Room>();
 constructor(private serviceId:string,private now=Date.now,private lifetime=7_200_000){}
 create(name:string){
  this.cleanup();if(this.rooms.size>=1000)throw new Error('Pairing capacity reached. Try later.');
  const secret=token(),credential=token(),code=randomBytes(6).toString('hex').toUpperCase(),id=randomUUID(),expires=this.now()+300_000;
  const host={id:randomUUID(),name,hash:digest(credential)};
  const room:Room={id,host,secret:digest(secret),code:digest(code),status:'waiting',pairExpiry:expires,expires,verification:randomBytes(3).toString('hex').toUpperCase()};
  this.rooms.set(id,room);
  const qr:PairingQr={version:1,service:'clipsync-pair',serviceId:this.serviceId,sessionId:id,secret,expiresAt:expires,deviceName:name};
  return {credentials:this.credentials(room,host,credential),qr,code,session:this.view(room,'host')};
 }
 private credentials(room:Room,device:Device,credential:string):Credentials{return {sessionId:room.id,token:credential,deviceId:device.id,expiresAt:room.expires};}
 private find(proof:{sessionId:string;secret:string}|{code:string}){
  this.cleanup();
  const room='code'in proof?[...this.rooms.values()].find(item=>equal(item.code,proof.code)):this.rooms.get(proof.sessionId);
  if(!room||room.status!=='waiting'||room.pairExpiry<=this.now()||('secret'in proof&&!equal(room.secret,proof.secret)))throw new Error('Pairing expired, consumed, or unavailable.');
  return room;
 }
 inspect(proof:{sessionId:string;secret:string}|{code:string}){const room=this.find(proof);return {sessionId:room.id,deviceName:room.host.name,expiresAt:room.pairExpiry,serviceId:this.serviceId};}
 join(proof:{sessionId:string;secret:string}|{code:string},name:string){
  const room=this.find(proof),credential=token();room.phone={id:randomUUID(),name,hash:digest(credential)};room.status='pending';
  room.secret=randomBytes(32);room.code=randomBytes(32);
  return{credentials:this.credentials(room,room.phone,credential),session:this.view(room,'phone')};
 }
 authenticate(auth:{sessionId:string;token:string}){
  const room=this.rooms.get(auth.sessionId);
  if(!room||room.expires<=this.now()||room.status==='revoked'||room.status==='expired')throw new Error('Session expired or revoked. Pair again.');
  const role:'host'|'phone'|null=equal(room.host.hash,auth.token)?'host':room.phone&&equal(room.phone.hash,auth.token)?'phone':null;
  if(!role)throw new Error('Session authorization rejected.');
  return{room,role};
 }
 confirm(auth:{sessionId:string;token:string}){
  const {room,role}=this.authenticate(auth);
  if(role!=='host'||room.status!=='pending'||!room.phone)throw new Error('Only the initiating PC can confirm a pending phone.');
  room.status='approved';room.expires=this.now()+this.lifetime;return this.view(room,role);
 }
 revoke(auth:{sessionId:string;token:string}){const {room}=this.authenticate(auth);room.status='revoked';return room.id;}
 authorized(auth:{sessionId:string;token:string}){const {room}=this.authenticate(auth);return room.status==='approved';}
 state(auth:{sessionId:string;token:string}){const {room,role}=this.authenticate(auth);return this.view(room,role);}
 states(id:string){const room=this.rooms.get(id);if(!room)return[];return [this.view(room,'host'),...(room.phone?[this.view(room,'phone')]:[])];}
 route(auth:{sessionId:string;token:string}){const {room,role}=this.authenticate(auth);if(room.status!=='approved'||!room.phone)throw new Error('Confirm pairing before signaling.');return {local:role==='host'?room.host.id:room.phone.id,remote:role==='host'?room.phone.id:room.host.id,role,sessionId:room.id};}
 private view(room:Room,role:'host'|'phone'):PairSession{
  const local=role==='host'?room.host:room.phone!,remote=role==='host'?room.phone:room.host;
  return {sessionId:room.id,status:room.status,deviceId:local.id,deviceName:local.name,peerId:remote?.id,peerName:remote?.name,verification:room.phone?room.verification:undefined,expiresAt:room.expires,role};
 }
 cleanup(){const removed:string[]=[];for(const [id,room]of this.rooms)if(room.expires<=this.now()||room.status==='revoked'){removed.push(id);this.rooms.delete(id);}return removed;}
}

export class RateLimits{
 private buckets=new Map<string,{count:number;until:number}>();
 constructor(private now=Date.now){}
 take(key:string,limit:number,window=60_000){
  const now=this.now();for(const [name,value]of this.buckets)if(value.until<=now)this.buckets.delete(name);
  let value=this.buckets.get(key);if(!value){if(this.buckets.size>=20_000)throw new Error('Service is busy. Try later.');value={count:0,until:now+window};this.buckets.set(key,value);}
  if(++value.count>limit)throw new Error('Rate limit reached. Try later.');
 }
}
