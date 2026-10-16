import { createHmac } from 'node:crypto';

export function turnCredentials(secret: string, userId: string, deviceId: string, ttl = 600, now = Date.now()) {
  const seconds = Math.max(60, Math.min(3600, ttl));
  const expiresAt = Math.floor(now / 1000) + seconds;
  const username = `${expiresAt}:${userId}:${deviceId}`;
  return { username, credential: createHmac('sha1', secret).update(username).digest('base64'), expiresAt };
}

export function allowedRtcOrigin(origin: string | null, requestOrigin: string, siteOrigin: string | undefined, extensionOrigins: string | undefined) {
  if (!origin) return false;
  const allowed = new Set([requestOrigin]);
  if (siteOrigin) { try { allowed.add(new URL(siteOrigin).origin); } catch {} }
  for (const value of (extensionOrigins || '').split(',')) {
    const entry = value.trim();
    if (/^chrome-extension:\/\/[a-p]{32}$/.test(entry)) allowed.add(entry);
  }
  return allowed.has(origin);
}
