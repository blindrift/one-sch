import { AppHeader } from '@/components/app-header';

// UI 틀. 권한은 admin 아래 각 page 의 requirePage('ADMIN') 가 검사한다.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex-1">{children}</div>
    </div>
  );
}
