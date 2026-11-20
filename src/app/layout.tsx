import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { HydrationMarker } from '@/components/hydration-marker';
import './globals.css';

export const metadata: Metadata = {
  title: 'one-sch',
  description: '프로젝트 타임라인',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 요청마다 nonce 가 달라지므로 동적 렌더를 강제한다.
  await headers();
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">
        {children}
        <HydrationMarker />
      </body>
    </html>
  );
}
