import Image from 'next/image';
import Link from 'next/link';

// 로그인 없이 열리는 안내 페이지(홈 소개·개인정보처리방침). 구글 OAuth 동의 화면의 링크 대상이다.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b border-line bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link href="/about" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="" width={28} height={28} unoptimized className="rounded-md" />
            <span className="text-[15px] font-semibold tracking-tight">one-sch</span>
          </Link>
          <Link
            href="/login"
            className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-brand-hover"
          >
            로그인
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12 text-[15px] leading-7 text-foreground/90 [&_li::marker]:text-text-subtle [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </main>
      <footer className="border-t border-line bg-surface-muted">
        <div className="mx-auto flex max-w-3xl gap-5 px-6 py-5 text-xs text-text-subtle">
          <span>© one-sch</span>
          <Link href="/about" className="hover:text-foreground">
            소개
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            개인정보처리방침
          </Link>
        </div>
      </footer>
    </div>
  );
}
