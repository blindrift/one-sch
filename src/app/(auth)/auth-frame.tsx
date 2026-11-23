import { BrandMark } from '@/components/brand-mark';

/** 로그인·비밀번호 변경 공용 틀: 옅은 회색 바탕 가운데 카드, 위에 워크스페이스 표시 */
export function AuthFrame({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-surface-muted p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(123,104,238,0.16),transparent)]"
      />
      <div className="relative flex items-center gap-2.5">
        <BrandMark className="size-8 text-base" />
        <span className="text-xl font-semibold tracking-tight">one-sch</span>
      </div>
      <div className="relative w-full max-w-[380px] rounded-2xl border border-line bg-background p-8 shadow-[0_8px_32px_rgba(16,24,40,0.08)]">
        {children}
      </div>
      {footer ? <div className="relative">{footer}</div> : null}
    </main>
  );
}

/** 구글 "G" 표시(구글 로그인 단추 안내 지침의 다색 G) */
export function GoogleG() {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px]" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
