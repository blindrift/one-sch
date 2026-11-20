import type { NextConfig } from 'next';

const https = (process.env.AUTH_URL ?? '').startsWith('https://');

const staticHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  ...(https ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: '1mb' },
  },
  outputFileTracingIncludes: {
    '/**': ['./node_modules/.prisma/client/**'],
  },
  async headers() {
    // middleware 가 건너뛰는 정적 자산에도 기본 헤더를 붙인다.
    return [
      { source: '/_next/static/:path*', headers: staticHeaders },
      { source: '/favicon.ico', headers: staticHeaders },
    ];
  },
};

export default nextConfig;
