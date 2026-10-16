export class FakeChannel {
  label='clipsync-v1';readyState='connecting';bufferedAmount=0;other?:FakeChannel;
  onopen:(()=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;onmessage:((event:{data:unknown})=>void)|null=null;
  sent:string[]=[];
  send(value:string){if(this.readyState!=='open')throw new Error('Not open');this.sent.push(value);queueMicrotask(()=>this.other?.onmessage?.({data:value}));}
  open(){this.readyState='open';this.onopen?.();}
  close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.();if(this.other?.readyState!=='closed'){const other=this.other;queueMicrotask(()=>other?.close());}}
  receive(value:unknown){this.onmessage?.({data:value});}
}
const offers=new Map<string,FakePeer>();
export class FakePeer {
  id=crypto.randomUUID();connectionState='new';signalingState='stable';localDescription:RTCSessionDescriptionInit|null=null;remoteDescription:RTCSessionDescriptionInit|null=null;
  channel?:FakeChannel;remote?:FakePeer;
  onicecandidate:((event:{candidate:null})=>void)|null=null;ondatachannel:((event:{channel:FakeChannel})=>void)|null=null;onconnectionstatechange:(()=>void)|null=null;
  createDataChannel(){this.channel=new FakeChannel();return this.channel;}
  async createOffer(){offers.set(this.id,this);return{type:'offer' as const,sdp:this.id};}
  async createAnswer(){return{type:'answer' as const,sdp:this.id};}
  async setLocalDescription(description:RTCSessionDescriptionInit){this.localDescription=description;this.signalingState=description.type==='offer'?'have-local-offer':'stable';}
  async setRemoteDescription(description:RTCSessionDescriptionInit){
    this.remoteDescription=description;
    if(description.type==='offer'){
      this.remote=offers.get(description.sdp!);if(!this.remote?.channel)throw new Error('Missing offer');
      this.channel=new FakeChannel();this.channel.other=this.remote.channel;this.remote.channel.other=this.channel;this.remote.remote=this;
      this.ondatachannel?.({channel:this.channel});
    }else{
      this.signalingState='stable';this.connectionState='connected';if(this.remote)this.remote.connectionState='connected';
      queueMicrotask(()=>{this.channel?.open();this.remote?.channel?.open();this.onconnectionstatechange?.();this.remote?.onconnectionstatechange?.();});
    }
  }
  async addIceCandidate(){}
  close(){this.connectionState='closed';this.channel?.close();offers.delete(this.id);}
}
