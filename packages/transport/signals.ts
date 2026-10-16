import { z } from 'zod';

export const signalSchema = z.object({
  id: z.uuid(), from_device: z.uuid(), to_device: z.uuid(), session_id: z.uuid(),
  kind: z.enum(['hello','offer','answer','ice']),
  payload: z.union([
    z.object({}).strict(),
    z.object({ type: z.enum(['offer','answer']), sdp: z.string().max(64_000) }).strict(),
    z.object({ candidate: z.string().max(4096), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().int().nullable().optional(), usernameFragment: z.string().nullable().optional() }).strict(),
  ]),
}).passthrough();
export type Signal = z.infer<typeof signalSchema>;
export type OutgoingSignal = Pick<Signal,'session_id'|'kind'|'payload'>;
export interface Signaling {
  start(onSignal: (signal: Signal) => void, onAvailable: (available: boolean) => void, onRevoked: () => void): Promise<void>;
  send(signal: OutgoingSignal): Promise<void>;
  authorize(): Promise<boolean>;
  stop(): Promise<void>;
}
