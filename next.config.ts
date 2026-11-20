import type { NextConfig } from 'next';

// headers() 는 빌드 때 평가되므로 런타임 값(AUTH_URL)에 따른 헤더(HSTS)는 여기 두지 않는다.
// HSTS 는 middleware(https 일 때)와 DSM 리버스 프록시가 붙인다.
const staticHeaders = [{ key: 'X-Content-Type-Options', value: 'nosniff' }];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: '1mb' },
    // forbidden() → app/forbidden.tsx(403)
    authInterrupts: true,
  },
  outputFileTracingIncludes: {
    '/**': ['./node_modules/.prisma/client/**'],
  },
  async headers() {
    // middleware 가 건너뛰는 정적 자산에도 기본 헤더를 붙인다.
    return [
      { source: '/_next/static/:path*', headers: staticHeaders },
      { source: '/favicon.ico', headers: staticHeaders },
      { source: '/robots.txt', headers: staticHeaders },
    ];
  },
};

export default nextConfig;
