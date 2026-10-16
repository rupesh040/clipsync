import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const MAX_TEXT_BYTES = 16_384;
export const MAX_WIRE_BYTES = 20_480;
export const MAX_MESSAGE_AGE = 120_000;
export const textSchema = z.string().min(1).max(20_000).refine(value => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= MAX_TEXT_BYTES, 'Use non-empty text under 16 KiB.');
const base = { version: z.literal(PROTOCOL_VERSION), id: z.uuid(), source: z.uuid(), destination: z.uuid(), session: z.uuid(), timestamp: z.number().int().positive() };
export const clipboardMessageSchema = z.object({ ...base, type: z.literal('clipboard'), text: textSchema, origin: z.enum(['page-copy','desktop-read','user-read','manual']) }).strict();
export const acknowledgementSchema = z.object({ ...base, type: z.literal('ack'), messageId: z.uuid() }).strict();
export const wireSchema = z.discriminatedUnion('type', [clipboardMessageSchema, acknowledgementSchema]);
export type ClipboardMessage = z.infer<typeof clipboardMessageSchema>;
export type WireMessage = z.infer<typeof wireSchema>;
export type MessageOrigin = ClipboardMessage['origin'];
export type ConnectionState = 'unpaired' | 'pairing' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export function encodeMessage(message: WireMessage) {
  const serialized = JSON.stringify(wireSchema.parse(message));
  if (new TextEncoder().encode(serialized).byteLength > MAX_WIRE_BYTES) throw new Error('Encoded clipboard message is too large.');
  return serialized;
}

export function decodeMessage(raw: unknown, local: string, remote: string, session: string, now = Date.now()): WireMessage {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_WIRE_BYTES) throw new Error('Invalid message size or encoding.');
  const result = wireSchema.safeParse(JSON.parse(raw));
  if (!result.success) throw new Error('Invalid clipboard protocol message.');
  const message = result.data;
  if (message.destination !== local || message.source !== remote || message.source === local || message.session !== session) throw new Error('Message is not authorized for this connection.');
  if (now - message.timestamp > MAX_MESSAGE_AGE || message.timestamp - now > 30_000) throw new Error('Message timestamp is outside the permitted window.');
  return message;
}

export class RecentIds {
  private values = new Map<string, number>();
  constructor(private maximum = 512, private lifetime = 300_000) {}
  has(id: string, now = Date.now()) { this.expire(now); return this.values.has(id); }
  add(id: string, now = Date.now()) { this.expire(now); this.values.set(id, now); while (this.values.size > this.maximum) this.values.delete(this.values.keys().next().value!); }
  private expire(now: number) { for (const [id, time] of this.values) if (now - time > this.lifetime) this.values.delete(id); }
}

export function reconnectDelay(attempt: number, random = Math.random) {
  return Math.round(Math.min(30_000, 750 * 2 ** Math.min(attempt, 6)) * (0.8 + random() * 0.4));
}

export async function fingerprint(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export class EchoGuard {
  private remote = '';
  private detected = '';
  async received(text: string) { this.remote = await fingerprint(text); this.detected = this.remote; }
  async shouldSend(text: string) {
    const current = await fingerprint(text);
    if (current === this.remote || current === this.detected) return false;
    this.remote = '';
    this.detected = current;
    return true;
  }
  reset() { this.remote = ''; this.detected = ''; }
}
