import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const rtcConfigurationSchema = z.object({ iceServers: z.array(z.object({ urls: z.union([z.string(),z.array(z.string())]), username: z.string().optional(), credential: z.string().optional() }).strict()).max(8), relayConfigured: z.boolean(), expiresAt: z.number().nullable() });

export async function fetchRtcConfiguration(client: SupabaseClient, deviceId: string, appOrigin: string, onRelay?: (available: boolean) => void): Promise<RTCConfiguration> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Sign in to configure WebRTC.');
  const response = await fetch(new URL('/api/rtc-config/',appOrigin), { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('WebRTC configuration unavailable. Check device approval and extension origin settings.');
  const configuration = rtcConfigurationSchema.parse(await response.json());
  onRelay?.(configuration.relayConfigured);
  return { iceServers: configuration.iceServers, iceTransportPolicy: 'all', iceCandidatePoolSize: 0 };
}
