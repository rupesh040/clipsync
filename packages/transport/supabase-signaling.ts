import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { signalSchema, type OutgoingSignal, type Signal, type Signaling } from './signals';

export class SupabaseSignaling implements Signaling {
  private channel?: RealtimeChannel;
  private active = false;
  constructor(private client: SupabaseClient, private local: string, private remote: string) {}

  async authorize() {
    const { data, error } = await this.client.rpc('authorize_peer', { local_device: this.local, remote_device: this.remote });
    return !error && data === true;
  }

  async start(onSignal: (signal: Signal) => void, onAvailable: (available: boolean) => void, onRevoked: () => void) {
    this.active = true;
    const session = await this.client.auth.getSession();
    if (!session.data.session) throw new Error('Sign in to start signaling.');
    await this.client.realtime.setAuth(session.data.session.access_token);
    this.channel = this.client.channel('rtc-device-' + this.local + '-' + this.remote)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rtc_signals', filter: 'to_device=eq.' + this.local }, event => {
        const parsed = signalSchema.safeParse(event.new);
        if (this.active && parsed.success && parsed.data.from_device === this.remote) onSignal(parsed.data);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, event => {
        if ([this.local,this.remote].includes(event.new.id) && event.new.revoked) onRevoked();
      })
      .subscribe(status => {
        if (!this.active) return;
        onAvailable(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') void this.client.from('rtc_signals').select('*').eq('to_device', this.local).eq('from_device', this.remote).gt('expires_at', new Date().toISOString()).order('created_at').limit(128).then(({ data }) => {
          if (this.active) for (const row of data || []) { const parsed = signalSchema.safeParse(row); if (parsed.success) onSignal(parsed.data); }
        });
      });
  }

  async send(signal: OutgoingSignal) {
    if (!this.active) throw new Error('Signaling is stopped.');
    const { error } = await this.client.rpc('send_rtc_signal', { local_device: this.local, remote_device: this.remote, connection_id: signal.session_id, signal_kind: signal.kind, signal_payload: signal.payload });
    if (error) throw new Error('Signaling request was rejected. Check device authorization and rate limits.');
  }

  async stop() {
    this.active = false;
    if (this.channel) { const channel = this.channel; this.channel = undefined; await this.client.removeChannel(channel); }
  }
}
