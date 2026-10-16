import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPublicConfiguration } from '../lib/configuration';
import { installationPlatform } from '../lib/pwa';
import { spawnSync } from 'node:child_process';

test('missing and incomplete configuration remains unavailable', () => {
  assert.equal(readPublicConfiguration({}).configured, false);
  assert.equal(readPublicConfiguration({ url: 'https://project.supabase.co' }).configured, false);
});
test('public configuration rejects credential-bearing and insecure URLs', () => {
  for (const url of ['http://project.supabase.co','https://user:password@example.com','https://example.com/?token=value','javascript:alert(1)','https://example.com/api']) assert.equal(readPublicConfiguration({ url, publishableKey: 'sb_publishable_test' }).configured, false);
  assert.equal(readPublicConfiguration({ url: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_test' }).configured, true);
});
test('secret and service-role keys cannot initialize a browser client', () => {
  const jwt = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  for (const key of ['sb_secret_test', jwt('service_role'), 'malformed']) assert.equal(readPublicConfiguration({ url: 'https://project.supabase.co', publishableKey: key }).configured, false);
  assert.equal(readPublicConfiguration({ url: 'https://project.supabase.co', anonKey: jwt('anon') }).configured, true);
});
test('installation help recognizes iOS including desktop-mode iPad', () => {
  assert.equal(installationPlatform('iPhone','iPhone',5), 'ios');
  assert.equal(installationPlatform('Macintosh','MacIntel',5), 'ios');
  assert.equal(installationPlatform('Android 15','Linux',5), 'android');
  assert.equal(installationPlatform('Windows','Win32',0), 'desktop');
});
test('production builds reject a public secret before Next can bundle it', () => {
  const secret = 'sb_secret_test_only_not_a_real_key';
  const result = spawnSync(process.execPath, ['scripts/check-public-env.mjs'], { encoding: 'utf8', env: { ...process.env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to build/);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
});
