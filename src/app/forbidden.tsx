import Link from 'next/link';

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">403</h1>
      <p className="text-muted-foreground">이 화면을 볼 권한이 없습니다.</p>
      <Link href="/" className="text-sm underline">
        처음으로
      </Link>
    </main>
  );
}
