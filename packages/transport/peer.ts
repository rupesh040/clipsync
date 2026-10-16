import { decodeMessage, encodeMessage, reconnectDelay, RecentIds, textSchema, type ClipboardMessage, type ConnectionState, type MessageOrigin, type WireMessage } from '../protocol';
import { signalSchema, type OutgoingSignal, type Signal, type Signaling } from './signals';

export type PeerOptions = {
  local: string;
  remote: string;
  signaling: Signaling;
  configuration: () => Promise<RTCConfiguration>;
  onClipboard: (message: ClipboardMessage) => void | Promise<void>;
  onState: (state: ConnectionState, detail: string) => void;
  onReceipt?: (timestamp: number) => void;
  createPeer?: (configuration: RTCConfiguration) => RTCPeerConnection;
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
  private candidates = new Map<string, RTCIceCandidateInit[]>();
  private pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private signalWork: Promise<void> = Promise.resolve();
  private messageWork: Promise<void> = Promise.resolve();

  constructor(private options: PeerOptions) {}

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.options.onState('connecting', 'Authenticating the paired connection.');
    try {
      if (!await this.authorized()) throw new Error('Device authorization is unavailable or revoked.');
      if (this.stopped) return;
      await this.options.signaling.start(signal => {
        this.signalWork = this.signalWork.then(() => this.receiveSignal(signal)).catch(() => this.retry('Connection negotiation failed.'));
      }, available => {
        if (this.stopped) return;
        this.available = available;
        if (available && this.attempt < 8) this.connect();
        else { this.closeConnection(); clearTimeout(this.timer); this.options.onState('reconnecting', 'Signaling is unavailable. Waiting for authenticated reconnection.'); }
      }, () => { this.options.onState('disconnected', 'Device access was revoked.'); void this.stop(false); });
      if (this.stopped) { await this.options.signaling.stop(); return; }
      this.heartbeat = setInterval(() => {
        void this.authorized(true).then(valid => {
          if (this.stopped) return;
          if (!valid) { this.options.onState('disconnected', 'Device access was revoked.'); void this.stop(false); }
          else if (this.available && !this.peer && !this.timer && this.attempt < 8) this.connect();
        }).catch(() => { if(this.stopped) return;this.closeConnection(); this.lease = 0; this.options.onState('reconnecting', 'Authorization check unavailable. Delivery is paused.'); });
      }, 10_000);
    } catch {
      if (this.stopped) return;
      this.options.onState('failed', 'Unable to authorize this device. Verify pairing or create a fresh session.');
      await this.stop(false);
    }
  }

  reconnect() {
    this.attempt = 0;
    this.connect();
  }

  private connect() {
    if (this.stopped || !this.available) return;
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
    textSchema.parse(text);
    if (!await this.authorized()) throw new Error('Device authorization expired. Reconnect first.');
    const channel = this.channel;
    if (this.stopped || !this.available || channel?.readyState !== 'open') throw new Error('The paired device is not connected. Nothing was queued or uploaded.');
    if (this.pending.size >= 16 || channel.bufferedAmount > 128_000) throw new Error('The connection is busy. Try again in a moment.');
    const message: ClipboardMessage = { version: 1, id: crypto.randomUUID(), source: this.options.local, destination: this.options.remote, session: this.session, timestamp: Date.now(), type: 'clipboard', text, origin };
    const encoded = encodeMessage(message);
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(message.id); reject(new Error('No receipt arrived. Keep the receiving app open and try again.')); }, 10_000);
      this.pending.set(message.id, { resolve, reject, timer });
      try { channel.send(encoded); } catch { clearTimeout(timer); this.pending.delete(message.id); reject(new Error('The DataChannel closed before sending.')); }
    });
  }

  async stop(announce = true) {
    this.stopped = true; this.available = false; this.lease = 0;
    clearTimeout(this.timer); this.timer = undefined; clearInterval(this.heartbeat);
    this.closeConnection(); this.candidates.clear();
    await this.options.signaling.stop();
    if (announce) this.options.onState('disconnected', 'Connection stopped.');
  }

  private async authorized(force = false) {
    if (!force && this.lease > Date.now()) return true;
    const valid = await this.options.signaling.authorize();
    this.lease = valid ? Date.now() + 10_000 : 0;
    return valid;
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
    if (signal.kind === 'hello') { if (this.options.local < this.options.remote && !this.peer && !this.timer && this.attempt < 8) this.connect(); return; }
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
    channel.onopen = () => { if (this.peer !== peer) return; clearTimeout(this.deadline); clearTimeout(this.timer); this.timer = undefined; this.attempt = 0; this.options.onState('connected', 'WebRTC DataChannel open. Delivery may be direct or TURN-relayed.'); };
    channel.onclose = () => { if (this.peer === peer && !this.stopped) this.retry('DataChannel closed.'); };
    channel.onerror = () => { if (this.peer === peer && !this.stopped) this.retry('DataChannel failed.'); };
    channel.onmessage = event => {
      this.messageWork = this.messageWork.then(async () => {
        if (this.peer !== peer || this.stopped || !this.available || !await this.authorized()) return;
        if (this.peer !== peer || this.stopped || !this.available) return;
        let message: WireMessage;
        try { message = decodeMessage(event.data, this.options.local, this.options.remote, this.session); } catch { return; }
        if (message.type === 'ack') {
          const pending = this.pending.get(message.messageId);
          if (pending) { clearTimeout(pending.timer); pending.resolve(); this.pending.delete(message.messageId); this.options.onReceipt?.(Date.now()); }
          return;
        }
        if (!this.recent.has(message.id)) { await this.options.onClipboard(message); this.recent.add(message.id); }
        if (channel.readyState === 'open') channel.send(encodeMessage({ version: 1, type: 'ack', id: crypto.randomUUID(), source: this.options.local, destination: this.options.remote, session: this.session, timestamp: Date.now(), messageId: message.id }));
      }).catch(() => this.options.onState('failed', 'The received message could not be accepted. No clipboard data was logged.'));
    };
  }

  private retry(detail: string) {
    if (this.stopped || this.timer) return;
    this.closeConnection();
    if (!this.available) { this.options.onState('reconnecting', 'Waiting for authenticated signaling.'); return; }
    if (this.attempt >= 8) { this.options.onState('failed', detail + ' Choose Reconnect to try again.'); return; }
    this.options.onState('reconnecting', detail);
    this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, reconnectDelay(this.attempt++));
  }

  private closeConnection() {
    this.generation += 1;
    clearTimeout(this.deadline); clearTimeout(this.disconnectTimer);
    if (this.channel) { this.channel.onclose = null; this.channel.onerror = null; this.channel.onmessage = null; this.channel.onopen = null; this.channel.close(); this.channel = null; }
    if (this.peer) { this.peer.onconnectionstatechange = null; this.peer.onicecandidate = null; this.peer.ondatachannel = null; this.peer.close(); this.peer = null; }
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Connection interrupted before receipt. Nothing was queued.')); }
    this.pending.clear();
  }
}
