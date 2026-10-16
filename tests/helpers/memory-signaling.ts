import type { OutgoingSignal,Signal,Signaling } from '../../packages/transport/signals';

export class MemorySignalBus {
  callbacks=new Map<string,(signal:Signal)=>void>();
  queued=new Map<string,Signal[]>();
  available=new Map<string,(available:boolean)=>void>();
  revoked=new Map<string,()=>void>();
  allowed=true;
  endpoint(local:string,remote:string):Signaling {
    return {
      authorize:async()=>this.allowed,
      start:async(receive,available,revoked)=>{
        this.callbacks.set(local,receive);this.available.set(local,available);this.revoked.set(local,revoked);available(true);
        const queued=this.queued.get(local)||[];this.queued.delete(local);for(const signal of queued)queueMicrotask(()=>receive(signal));
      },
      send:async(outgoing:OutgoingSignal)=>{
        const signal:Signal={...outgoing,id:crypto.randomUUID(),from_device:local,to_device:remote};
        const receive=this.callbacks.get(remote);
        if(receive)queueMicrotask(()=>receive(signal));else this.queued.set(remote,[...(this.queued.get(remote)||[]),signal]);
      },
      stop:async()=>{this.callbacks.delete(local);this.available.delete(local);this.revoked.delete(local);},
    };
  }
}

export async function waitFor(condition:()=>boolean,timeout=4000){const start=Date.now();while(!condition()){if(Date.now()-start>timeout)throw new Error('Test condition timed out.');await new Promise(resolve=>setTimeout(resolve,10));}}
