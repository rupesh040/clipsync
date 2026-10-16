import nextEnvironment from '@next/env';

nextEnvironment.loadEnvConfig(process.cwd(), false);
for (const [name, value] of Object.entries(process.env)) {
  if (!name.startsWith('NEXT_PUBLIC_') || !value) continue;
  let privileged = value.startsWith('sb_secret_') || value.includes('-----BEGIN PRIVATE KEY-----');
  if (value.split('.').length === 3) {
    try { privileged ||= JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).role === 'service_role'; } catch {}
  }
  if (privileged) throw new Error(`Refusing to build: ${name} contains a private credential. Remove it before building.`);
}
console.log('Public environment credential guard passed.');
