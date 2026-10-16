import { createClient } from '@supabase/supabase-js';
import { readPublicConfiguration } from '../lib/configuration';

const configuration = readPublicConfiguration({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY });
if (!configuration.configured) {
  console.error(configuration.error || 'Supabase is not configured. Complete .env.local first.');
  process.exitCode = 2;
} else {
  try {
    const settings = await fetch(new URL('/auth/v1/settings',configuration.url), { headers: { apikey: configuration.key }, signal: AbortSignal.timeout(10000) });
    if (!settings.ok) throw new Error('The Supabase Auth endpoint rejected the public configuration.');
    console.log('Supabase Auth endpoint is reachable with the public project configuration.');
    const token = process.env.CLIPSYNC_VERIFY_ACCESS_TOKEN;
    if (!token) {
      console.log('Authenticated database and Realtime verification remains pending. Set a short-lived test-user access token locally to continue.');
      process.exitCode = 2;
    } else {
      const client = createClient(configuration.url, configuration.key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
      const identity = await client.auth.getUser(token);
      if (identity.error || !identity.data.user) throw new Error('The test-user access token is invalid or expired.');
      const health = await client.rpc('health_check');
      if (health.error || health.data?.schema_version !== 2) throw new Error('Base schema verification failed. Apply the required timestamped migrations.');
      const reads = await Promise.all([client.from('profiles').select('id').single(), client.from('devices').select('id').limit(1), client.from('rtc_signals').select('id').limit(1)]);
      if (reads.some(result => result.error)) throw new Error('An authenticated database read failed. Check migrations and RLS policies.');
      const foreign = await client.from('devices').select('id').neq('user_id', identity.data.user.id).limit(1);
      if (foreign.error || foreign.data?.length) throw new Error('Account isolation check failed.');
      await client.realtime.setAuth(token);
      const channel = client.channel('configuration-verification')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `user_id=eq.${identity.data.user.id}` }, () => {})
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rtc_signals', filter: `user_id=eq.${identity.data.user.id}` }, () => {});
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Realtime subscription timed out.')),10000);
        channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('Realtime subscription failed.')); } });
      }).finally(() => client.removeChannel(channel));
      console.log('Verified user identity, schema version, authenticated reads, account-filtered device read, and Realtime subscription. Two-device pairing and delivery still require the documented integration checklist.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Backend verification failed.');
    process.exitCode = 1;
  }
}
