import { decodeMessage, encodeMessage, MAX_MESSAGE_AGE, reconnectDelay, RecentIds, textSchema, type ClipboardMessage, type ConnectionState, type MessageOrigin, type WireMessage } from '../protocol';
import { signalSchema, type OutgoingSignal, type Signal, type Signaling } from './signals';
import {TransferLedger} from './ledger';

export type PeerOptions = {
  local: string;
  remote: string;
  signaling: Signaling;
  configuration: () => Promise<RTCConfiguration>;
  onClipboard: (message: ClipboardMessage) => void | Promise<void>;
  onState: (state: ConnectionState, detail: string) => void;
  onReceipt?: (timestamp: number) => void;
  createPeer?: (configuration: RTCConfiguration) => RTCPeerConnection;
  ledger?: TransferLedger;
  receiptTimeout?: number;
};

export class ClipboardPeer {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private session = '';
  private stopped = true;
  private available = false;
  private attempt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private lease = 0;
  private recent = new RecentIds();
  readonly ledger: TransferLedger;
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private checking: Promise<boolean> | null = null;
  private subscribed = false;
  private initializing: Promise<void> | null = null;
  private candidates = new Map<string, RTCIceCandidateInit[]>();
  private pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  private receipts = new Map<string, ReturnType<typeof setTimeout>>();
  private signalWork: Promise<void> = Promise.resolve();
  private messageWork: Promise<void> = Promise.resolve();

  constructor(private options: PeerOptions) {this.ledger=options.ledger||new TransferLedger(options.local,options.remote);}

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.options.onState('connecting', 'Authenticating the paired connection.');
    this.heartbeat = setInterval(() => {void this.recover();}, 10_000);
    await this.initialize();
  }

  private initialize(){if(!this.initializing)this.initializing=this.setup().finally(()=>{this.initializing=null;});return this.initializing;}

  private async setup() {
    try {
      if (!await this.authorized()) {this.options.onState('disconnected','Device access was revoked.');await this.stop(false);return;}
      if (this.stopped) return;
      await this.options.signaling.start(signal => {
        this.signalWork = this.signalWork.then(() => this.receiveSignal(signal)).catch(() => this.retry('Connection negotiation failed.'));
      }, available => {
        if (this.stopped) return;
        this.available = available;
        if (available) {if(this.channel?.readyState==='open'){this.options.onState('connected','Connection retained. Resuming queued delivery.');void this.flush();}else if(!this.peer&&!this.timer)this.connect();}
        else this.options.onState('reconnecting', 'Signaling interrupted. The peer connection and pending text are retained.');
      }, () => { this.options.onState('disconnected', 'Device access was revoked.'); void this.stop(false); });
      if (this.stopped) { await this.options.signaling.stop(); return; }
      this.subscribed=true;
    } catch {
      if (this.stopped) return;
      this.options.onState('reconnecting', 'Authorization is temporarily unavailable. Retrying automatically; pending text stays local.');
    }
  }

  async recover() {
    if(this.stopped)return;
    if(!this.subscribed){await this.initialize();return;}
    try{
      if(!await this.authorized(true)){this.options.onState('disconnected','Device access was revoked.');await this.stop(false);return;}
      if(this.stopped)return;
      if(this.channel?.readyState==='open'){this.options.onState('connected','WebRTC DataChannel open. Pending updates retry automatically.');await this.flush();}
      else if(this.available&&!this.peer&&!this.timer)this.connect();
    }catch{this.lease=0;if(!this.stopped)this.options.onState('reconnecting','Waiting for authorization. Connection and queued updates are retained.');}
  }

  reconnect() {this.attempt=0;void this.recover();}

  private connect(force=false) {
    if (this.stopped || !this.available) return;
    if(!force&&this.channel?.readyState==='open'){void this.flush();return;}
    clearTimeout(this.timer); this.timer = undefined;
    this.closeConnection();
    this.options.onState('connecting', 'Establishing a WebRTC DataChannel.');
    if (this.options.local < this.options.remote) void this.offer().catch(() => this.retry('Unable to start a peer connection.'));
    else {
      void this.options.signaling.send({ kind: 'hello', session_id: crypto.randomUUID(), payload: {} }).catch(() => this.retry('Unable to reach the paired device.'));
      this.deadline = setTimeout(() => this.retry('Peer did not connect. Keep both apps open; TURN may be required.'), 15_000);
    }
  }

  async send(text: string, origin: MessageOrigin = 'manual') {
    const queued=await this.enqueue(text,origin);return queued.delivered;
  }

  async enqueue(text:string,origin:MessageOrigin='manual'){
    textSchema.parse(text);if(this.stopped)throw new Error('Connect an authorized peer before queuing text.');
    const message=await this.ledger.add(text,origin);
    if(this.stopped)throw new Error('Connection paused while saving. Text remains queued for this session.');
    const delivered=new Promise<void>((resolve,reject)=>{this.pending.set(message.id,{resolve,reject});});
    void delivered.catch(()=>{});void this.flush();
    return{id:message.id,delivered};
  }

  private flush():Promise<void>{
    if(this.flushing){this.flushAgain=true;return this.flushing;}
    this.flushing=(async()=>{
      await this.ledger.ready;
      if(this.stopped||!this.available||this.channel?.readyState!=='open'||!await this.authorized())return;
      const channel=this.channel;if(this.stopped||channel?.readyState!=='open')return;
      for(const message of this.ledger.entries()){
        if(Date.now()-message.timestamp>MAX_MESSAGE_AGE){await this.ledger.acknowledge(message.id);this.pending.get(message.id)?.reject(new Error('Queued update exceeded the two-hour delivery window and was not applied.'));this.pending.delete(message.id);continue;}
        if(this.receipts.has(message.id))continue;
        if(this.receipts.size>=16||channel.bufferedAmount>128_000)break;
        if(this.ledger.expiresAt<=Date.now()){await this.stop();return;}
        const timer=setTimeout(()=>{this.receipts.delete(message.id);this.retry('Receipt delayed. Retrying the same update without duplicating it.');},this.options.receiptTimeout||5000);
        this.receipts.set(message.id,timer);
        try{channel.send(encodeMessage({...message,session:this.session}));}catch{this.retry('Delivery interrupted. Pending text will retry automatically.');break;}
      }
    })().catch(()=>{if(!this.stopped)this.options.onState('reconnecting','Delivery will retry after authorization recovers.');}).finally(()=>{this.flushing=null;if(this.flushAgain&&!this.stopped){this.flushAgain=false;void this.flush();}});
    return this.flushing;
  }

  async stop(announce = true) {
    this.stopped = true; this.available = false; this.lease = 0;
    clearTimeout(this.timer); this.timer = undefined; clearInterval(this.heartbeat);
    this.closeConnection(); this.candidates.clear();
    this.subscribed=false;
    for(const pending of this.pending.values())pending.reject(new Error('Delivery stopped. Unacknowledged text remains in this session queue.'));
    this.pending.clear();
    await this.options.signaling.stop();
    if (announce) this.options.onState('disconnected', 'Connection stopped.');
  }

  private async authorized(force = false) {
    if (!force && this.lease > Date.now()) return true;
    if(this.checking)return this.checking;
    this.checking=this.options.signaling.authorize().then(valid=>{this.lease=valid?Date.now()+10_000:0;return valid;}).finally(()=>{this.checking=null;});
    return this.checking;
  }

  private async createConnection(session: string) {
    this.closeConnection();
    const generation = this.generation;
    const configuration = await this.options.configuration();
    if (this.stopped || generation !== this.generation || !this.available) throw new Error('Connection superseded.');
    this.session = session;
    const peer = (this.options.createPeer || (config => new RTCPeerConnection(config)))(configuration);
    this.peer = peer;
    peer.onicecandidate = event => { if (event.candidate && this.peer === peer) void this.options.signaling.send({ kind: 'ice', session_id: session, payload: event.candidate.toJSON() as OutgoingSignal['payload'] }).catch(() => this.retry('ICE signaling failed.')); };
    peer.ondatachannel = event => { if (this.peer === peer) this.attach(event.channel, peer); };
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer || this.stopped) return;
      if (peer.connectionState === 'failed') this.retry('Network path failed. Retrying with a fresh ICE connection.');
      else if (peer.connectionState === 'disconnected') { clearTimeout(this.disconnectTimer); this.disconnectTimer = setTimeout(() => this.retry('Network interrupted.'), 4000); }
      else if (peer.connectionState === 'connected') clearTimeout(this.disconnectTimer);
    };
    this.deadline = setTimeout(() => this.retry('Connection timed out. Check the peer and TURN configuration.'), 15_000);
    return peer;
  }

  private async offer() {
    const session = crypto.randomUUID();
    const peer = await this.createConnection(session);
    this.attach(peer.createDataChannel('clipsync-v1', { ordered: true }), peer);
    await peer.setLocalDescription(await peer.createOffer());
    if (this.peer !== peer || !peer.localDescription) return;
    await this.options.signaling.send({ kind: 'offer', session_id: session, payload: { type: 'offer', sdp: peer.localDescription.sdp } });
  }

  private async receiveSignal(input: Signal) {
    if (this.stopped || !this.available) return;
    const parsed = signalSchema.safeParse(input);
    if (!parsed.success) return;
    const signal = parsed.data;
    if (signal.to_device !== this.options.local || signal.from_device !== this.options.remote) return;
    if (!await this.authorized()) { await this.stop(); return; }
    if (this.stopped || !this.available) return;
    if (signal.kind === 'hello') { if (this.options.local < this.options.remote && (!this.peer||this.channel?.readyState==='open') && !this.timer) this.connect(true); return; }
    if (signal.kind === 'ice') {
      if (!('candidate' in signal.payload)) return;
      if (this.peer?.remoteDescription && signal.session_id === this.session) await this.peer.addIceCandidate(signal.payload);
      else { const queue = this.candidates.get(signal.session_id) || []; if (queue.length < 64) queue.push(signal.payload); if (this.candidates.size < 8 || this.candidates.has(signal.session_id)) this.candidates.set(signal.session_id, queue); }
      return;
    }
    if (!('sdp' in signal.payload) || signal.payload.type !== signal.kind) return;
    if (signal.kind === 'offer') {
      if (this.options.remote > this.options.local) return;
      if (signal.session_id === this.session && this.peer) return;
      const peer = await this.createConnection(signal.session_id);
      await peer.setRemoteDescription({ type: 'offer', sdp: signal.payload.sdp });
      await this.flushCandidates(peer, signal.session_id);
      await peer.setLocalDescription(await peer.createAnswer());
      if (this.peer === peer && peer.localDescription) await this.options.signaling.send({ kind: 'answer', session_id: signal.session_id, payload: { type: 'answer', sdp: peer.localDescription.sdp } });
    } else if (signal.kind === 'answer' && signal.session_id === this.session && this.peer?.signalingState === 'have-local-offer') {
      await this.peer.setRemoteDescription({ type: 'answer', sdp: signal.payload.sdp });
      await this.flushCandidates(this.peer, signal.session_id);
    }
  }

  private async flushCandidates(peer: RTCPeerConnection, session: string) {
    const queue = this.candidates.get(session) || []; this.candidates.delete(session);
    for (const candidate of queue) if (this.peer === peer) await peer.addIceCandidate(candidate);
  }

  private attach(channel: RTCDataChannel, peer: RTCPeerConnection) {
    if (this.channel && this.channel !== channel) { channel.close(); return; }
    if (channel.label !== 'clipsync-v1') { channel.close(); return; }
    this.channel = channel;
    channel.onopen = () => { if (this.peer !== peer) return; clearTimeout(this.deadline); clearTimeout(this.timer); this.timer = undefined; this.attempt = 0; this.options.onState('connected', 'WebRTC DataChannel open. Pending updates retry automatically.');void this.flush(); };
    channel.onclose = () => { if (this.peer === peer && !this.stopped) this.retry('DataChannel closed.'); };
    channel.onerror = () => { if (this.peer === peer && !this.stopped) this.retry('DataChannel failed.'); };
    channel.onmessage = event => {
      this.messageWork = this.messageWork.then(async () => {
        if (this.peer !== peer || this.stopped || !this.available || !await this.authorized()) return;
        if (this.peer !== peer || this.stopped || !this.available) return;
        let message: WireMessage;
        try { message = decodeMessage(event.data, this.options.local, this.options.remote, this.session); } catch { return; }
        if (message.type === 'ack') {
          if(!this.ledger.entries().some(entry=>entry.id===message.messageId))return;
          await this.ledger.acknowledge(message.messageId);
          clearTimeout(this.receipts.get(message.messageId));this.receipts.delete(message.messageId);
          const pending = this.pending.get(message.messageId);
          if (pending) {pending.resolve(); this.pending.delete(message.messageId);}
          this.options.onReceipt?.(Date.now());void this.flush();
          return;
        }
        if (!this.recent.has(message.id)) { await this.ledger.accept(message,()=>{if(this.stopped||this.peer!==peer)throw new Error('Delivery paused.');return this.options.onClipboard(message);}); this.recent.add(message.id); }
        if (channel.readyState === 'open') channel.send(encodeMessage({ version: 1, type: 'ack', id: crypto.randomUUID(), source: this.options.local, destination: this.options.remote, session: this.session, timestamp: Date.now(), messageId: message.id }));
      }).catch(() => {if(!this.stopped)this.options.onState('failed', 'The received message could not be accepted. No clipboard data was logged.');});
    };
  }

  private retry(detail: string) {
    if (this.stopped || this.timer) return;
    this.closeConnection();
    if (!this.available) { this.options.onState('reconnecting', 'Waiting for authenticated signaling.'); return; }
    this.options.onState('reconnecting', detail);
    this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, reconnectDelay(this.attempt++));
  }

  private closeConnection() {
    this.generation += 1;
    clearTimeout(this.deadline); clearTimeout(this.disconnectTimer);
    if (this.channel) { this.channel.onclose = null; this.channel.onerror = null; this.channel.onmessage = null; this.channel.onopen = null; this.channel.close(); this.channel = null; }
    if (this.peer) { this.peer.onconnectionstatechange = null; this.peer.onicecandidate = null; this.peer.ondatachannel = null; this.peer.close(); this.peer = null; }
    for(const timer of this.receipts.values())clearTimeout(timer);this.receipts.clear();
  }
}
