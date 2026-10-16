import { z } from 'zod';
import type { ClipboardMessage } from '@/packages/protocol';
import { textSchema } from '@/packages/protocol';
import type { Clip } from './clipboard';

export type SyncDirection = 'both' | 'receive' | 'send';
export type LocalState = { enabled: boolean; days: number; direction: SyncDirection; latest: Clip | null; items: Clip[]; storageError?: string };
const empty: LocalState = { enabled: false, days: 7, direction: 'both', latest: null, items: [] };
const savedClip = z.object({ id: z.uuid(), content: textSchema, source: z.string().max(100), created_at: z.iso.datetime(), pinned: z.boolean(), device_id: z.uuid().optional(), acknowledged_at: z.string().nullable().optional() });
const savedState = z.object({ enabled: z.boolean(), days: z.union([z.literal(1),z.literal(7),z.literal(30)]), direction: z.enum(['both','receive','send']), items: z.array(savedClip).max(50) });

export class LocalClipboardStore {
  private state: LocalState = empty;
  private listeners = new Set<() => void>();
  private hydrated = false;
  constructor(private key: string, private storage?: Storage) {}
  getSnapshot = () => this.state;
  getServerSnapshot = () => empty;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.hydrated) { this.hydrated = true; this.load(); }
    return () => { this.listeners.delete(listener); };
  };
  receive(message: ClipboardMessage, source: string) {
    const clip: Clip = { id: message.id, content: message.text, source: source.slice(0,100), created_at: new Date(message.timestamp).toISOString(), pinned: false, device_id: message.source, acknowledged_at: new Date().toISOString() };
    this.update({ ...this.state, latest: clip, items: this.state.enabled ? [clip,...this.state.items.filter(item => item.id !== clip.id)].slice(0,50) : [] }, false);
  }
  preferences(enabled: boolean, days: number, direction = this.state.direction) {
    if (![1,7,30].includes(days) || !['both','receive','send'].includes(direction)) throw new Error('Invalid local preferences.');
    this.update({ ...this.state, enabled, days, direction, items: enabled ? this.state.items : [] });
  }
  mutate(operation: 'pin' | 'delete' | 'clear', id?: string, value?: boolean) {
    if (operation === 'clear') this.update({ ...this.state, latest: null, items: [] });
    else if (operation === 'delete') this.update({ ...this.state, latest: this.state.latest?.id === id ? null : this.state.latest, items: this.state.items.filter(item => item.id !== id) });
    else this.update({ ...this.state, items: this.state.items.map(item => item.id === id ? { ...item, pinned: Boolean(value) } : item) });
  }
  clearMemory() { this.state = { ...this.state, latest: null, items: [] }; this.emit(); }
  private load() {
    try {
      const parsed = savedState.safeParse(JSON.parse(this.storage?.getItem(this.key) || 'null'));
      if (parsed.success) this.state = { ...parsed.data, latest: null, items: parsed.data.enabled ? parsed.data.items.filter(item => Date.now() - Date.parse(item.created_at) < parsed.data.days * 86_400_000) : [] };
    } catch {}
    this.emit();
  }
  private update(state: LocalState, reportFailure = true) {
    this.state = { ...state, storageError: '', items: state.items.filter(item => Date.now() - Date.parse(item.created_at) < state.days * 86_400_000) };
    try { this.storage?.setItem(this.key, JSON.stringify({ enabled: state.enabled, days: state.days, direction: state.direction, items: state.enabled ? this.state.items : [] })); }
    catch {
      this.state = { ...this.state, storageError: 'Local storage is unavailable or full. Receiving continues in memory; saved history may be incomplete. Free storage or clear site data.' };
      this.emit();
      if (reportFailure) throw new Error(this.state.storageError);
      return;
    }
    this.emit();
  }
  private emit() { for (const listener of this.listeners) listener(); }
}

const stores = new Map<string, LocalClipboardStore>();
export function localClipboardStore(account: string) {
  const key = 'clipsync-p2p-local-' + account;
  if (!stores.has(key)) {
    let storage: Storage | undefined;
    try { if (typeof window !== 'undefined') storage = window.localStorage; } catch {}
    stores.set(key,new LocalClipboardStore(key,storage));
  }
  return stores.get(key)!;
}
