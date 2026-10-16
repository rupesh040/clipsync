type PublicEnvironment = { url?: string; publishableKey?: string; anonKey?: string };

export function readPublicConfiguration(environment: PublicEnvironment) {
  const url = environment.url?.trim() || '';
  const key = (environment.publishableKey || environment.anonKey || '').trim();
  if (!url && !key) return { configured: false, error: '', url, key };
  if (!url || !key) return { configured: false, error: 'Both the Supabase project URL and public key are required.', url: '', key: '' };
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) throw new Error();
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error();
  } catch {
    return { configured: false, error: 'Use an HTTPS Supabase project URL, or HTTP localhost for local Supabase.', url: '', key: '' };
  }
  if (key.startsWith('sb_secret_')) return { configured: false, error: 'A secret key cannot be used in public application configuration.', url: '', key: '' };
  if (!key.startsWith('sb_publishable_')) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
      if (payload.role !== 'anon') throw new Error();
    } catch {
      return { configured: false, error: 'Use a publishable key or a legacy anon key, never a service-role key.', url: '', key: '' };
    }
  }
  return { configured: true, error: '', url, key };
}
