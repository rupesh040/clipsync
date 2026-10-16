import type { NextConfig } from 'next';
const config: NextConfig = {
  trailingSlash: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/auth/callback/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};
export default config;
