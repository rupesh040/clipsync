import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { readPublicConfiguration } from '@/lib/configuration';
import { allowedRtcOrigin, turnCredentials } from '@/lib/rtc-credentials';

export const runtime = 'nodejs';

function cors(request: Request) {
  const origin = request.headers.get('origin');
  if (!allowedRtcOrigin(origin, new URL(request.url).origin, process.env.NEXT_PUBLIC_SITE_URL, process.env.EXTENSION_ORIGINS)) return null;
  return { 'Access-Control-Allow-Origin': origin!, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Cache-Control': 'no-store', Vary: 'Origin' };
}

export async function OPTIONS(request: Request) {
  const headers = cors(request);
  return new Response(null, { status: headers ? 204 : 403, headers: headers || { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const headers = cors(request);
  if (!headers) return Response.json({ error: 'Origin is not authorized.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  if (Number(request.headers.get('content-length') || 0) > 1024) return Response.json({ error: 'Request too large.' }, { status: 413, headers });
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  const configuration = readPublicConfiguration({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY });
  if (!configuration.configured) return Response.json({ error: 'Supabase is not configured.' }, { status: 503, headers });
  try {
    const body = await request.text();
    if (body.length > 1024) return Response.json({ error: 'Request too large.' }, { status: 413, headers });
    const { deviceId } = z.object({ deviceId: z.uuid() }).strict().parse(JSON.parse(body));
    const token = authorization.slice(7);
    const client = createClient(configuration.url, configuration.key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return Response.json({ error: 'Session is invalid or expired.' }, { status: 401, headers });
    const allowed = await client.rpc('authorize_rtc_configuration', { local_device: deviceId });
    if (allowed.error || allowed.data !== true) return Response.json({ error: 'Device authorization or configuration rate limit rejected this request.' }, { status: 403, headers });
    const stun = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map(value => value.trim()).filter(value => /^stuns?:[^\s]+$/.test(value));
    const iceServers: RTCIceServer[] = stun.length ? [{ urls: stun }] : [];
    const turns = (process.env.TURN_URLS || '').split(',').map(value => value.trim()).filter(value => /^turns?:[^\s@]+$/.test(value));
    let expiresAt: number | null = null;
    if (turns.length && process.env.TURN_SHARED_SECRET) {
      const credentials = turnCredentials(process.env.TURN_SHARED_SECRET, data.user.id, deviceId, Number(process.env.TURN_TTL_SECONDS) || 600);
      iceServers.push({ urls: turns, username: credentials.username, credential: credentials.credential }); expiresAt = credentials.expiresAt;
    }
    return Response.json({ iceServers, relayConfigured: expiresAt !== null, expiresAt }, { headers });
  } catch {
    return Response.json({ error: 'Unable to configure the peer connection.' }, { status: 400, headers });
  }
}
