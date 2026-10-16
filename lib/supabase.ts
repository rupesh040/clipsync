import { createClient } from '@supabase/supabase-js';
import { readPublicConfiguration } from './configuration';

export const publicConfiguration = readPublicConfiguration({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
export const backend = publicConfiguration.configured ? createClient(publicConfiguration.url, publicConfiguration.key, {
  auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
}) : null;
