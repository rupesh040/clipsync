import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import sharp from 'sharp';

function worker() {
  const origin = 'https://clipsync.example';
  const handlers = new Map<string, (event: unknown) => void>();
  const saved = new Map<string, Response>();
  let offline = false;
  const key = (request: string | Request) => new URL(typeof request === 'string' ? request : request.url, origin).pathname;
  const cache = { addAll: async (paths: string[]) => { for (const path of paths) saved.set(path, new Response('offline shell')); }, put: async (request: Request, response: Response) => { saved.set(key(request), response); } };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { location: { origin }, addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler), skipWaiting: async () => {}, clients: { claim: async () => {} } },
    URL, Response,
    caches: { open: async () => cache, match: async (request: Request | string) => saved.get(key(request))?.clone(), keys: async () => ['clipsync-static-v1'], delete: async () => true },
    fetch: async () => { if (offline) throw new Error('Offline'); return new Response('network response'); },
  });
  return {
    saved,
    offline: () => { offline = true; },
    install: async () => { let pending: Promise<unknown> | undefined; handlers.get('install')!({ waitUntil: (task: Promise<unknown>) => { pending = task; } }); await pending; },
    request: async (path: string, options: { method?: string; mode?: string; authorization?: string } = {}) => {
      let response: Promise<Response> | undefined;
      const pending: Promise<unknown>[] = [];
      handlers.get('fetch')!({ request: { url: new URL(path, origin).href, method: options.method || 'GET', mode: options.mode || 'cors', headers: new Headers(options.authorization ? { authorization: options.authorization } : {}) }, respondWith: (task: Promise<Response>) => { response = task; }, waitUntil: (task: Promise<unknown>) => pending.push(task) });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
  };
}

test('only public offline assets are precached', async () => {
  const service = worker(); await service.install();
  assert(service.saved.has('/offline.html'));
  for (const path of ['/dashboard/','/auth/callback/','/history/']) assert.equal(service.saved.has(path), false);
});
test('navigations use network without caching any signed-in response', async () => {
  const service = worker();
  assert.equal(await (await service.request('/dashboard/', { mode: 'navigate' }))!.text(), 'network response');
  assert.equal(service.saved.size, 0);
  service.offline(); await service.install();
  assert.equal(await (await service.request('/auth/callback/?code=sensitive', { mode: 'navigate' }))!.text(), 'offline shell');
});
test('API, cross-origin, mutation, RSC and authorization requests are never cached', async () => {
  const service = worker();
  for (const [path, options] of [
    ['https://project.supabase.co/rest/v1/clips', {}],
    ['/api/clips', { method: 'POST' }],
    ['/dashboard/?_rsc=abc', {}],
    ['/auth/callback/?code=secret', {}],
    ['/_next/static/chunk.js', { authorization: 'Bearer test-only' }],
  ] as const) assert.equal(await service.request(path, options), undefined);
  assert.equal(service.saved.size, 0);
});
test('hashed Next static assets are cached for repeat loading', async () => {
  const service = worker();
  assert.equal(await (await service.request('/_next/static/chunks/example.js'))!.text(), 'network response');
  service.offline();
  assert.equal(await (await service.request('/_next/static/chunks/example.js'))!.text(), 'network response');
});
test('manifest has valid install identity, scope and generated PNG dimensions', async () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, '/'); assert.equal(manifest.start_url, '/dashboard/');
  assert(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const metadata = await sharp(`public${icon.src}`).metadata();
    assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes);
    assert.equal(metadata.format, 'png');
  }
});
