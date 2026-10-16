import {z} from 'zod';
import type {GuestClient} from '../pairing/client';
import type {OutgoingSignal,Signal,Signaling} from './signals';
const iceConfiguration=z.object({iceServers:z.array(z.object({urls:z.union([z.string(),z.array(z.string())]),username:z.string().optional(),credential:z.string().optional()})),relayConfigured:z.boolean(),expiresAt:z.number().nullable()});
export class GuestSignaling implements Signaling{
 private removeSignal?:()=>void;
 private removeState?:()=>void;
 private active=false;
 constructor(private client:GuestClient){}
 async authorize(){const value=await this.client.request('authorize');return z.object({authorized:z.boolean()}).parse(value).authorized;}
 async start(onSignal:(signal:Signal)=>void,onAvailable:(value:boolean)=>void,onRevoked:()=>void){
  this.active=true;let last:boolean|undefined;
  const update=()=>{if(!this.active)return;const state=this.client.getSnapshot();const available=state.online&&state.session?.status==='approved';if(available!==last){last=available;onAvailable(available);}if(state.session&&['expired','revoked'].includes(state.session.status))onRevoked();};
  this.removeSignal=this.client.onSignal(onSignal);this.removeState=this.client.subscribe(update);update();
 }
 async send(signal:OutgoingSignal){if(!this.active)throw new Error('Connection is stopped.');await this.client.request('signal',{signal});}
 async stop(){this.active=false;this.removeSignal?.();this.removeState?.();}
 async configuration(onRelay?:(enabled:boolean)=>void):Promise<RTCConfiguration>{const value=iceConfiguration.parse(await this.client.request('configuration'));onRelay?.(value.relayConfigured);return{iceServers:value.iceServers};}
}
