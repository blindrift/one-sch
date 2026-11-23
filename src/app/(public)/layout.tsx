import Image from 'next/image';
import Link from 'next/link';

// 로그인 없이 열리는 안내 페이지(홈 소개·개인정보처리방침). 구글 OAuth 동의 화면의 링크 대상이다.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex items-center gap-3">
        <Image src="/logo.png" alt="" width={36} height={36} unoptimized className="rounded-lg" />
        <Link href="/about" className="text-lg font-semibold">
          one-sch
        </Link>
      </header>
      <main className="flex flex-col gap-6 text-sm leading-relaxed">{children}</main>
      <footer className="mt-auto flex gap-4 border-t pt-4 text-xs text-muted-foreground">
        <Link href="/about">소개</Link>
        <Link href="/privacy">개인정보처리방침</Link>
        <Link href="/login">로그인</Link>
      </footer>
    </div>
  );
}
