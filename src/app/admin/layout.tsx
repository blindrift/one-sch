// UI 틀. 권한은 admin 아래 각 page 의 requirePage('ADMIN') 가 검사하고, 화면 틀(사이드바)도 page 가 AppShell 로 그린다
// (layout 은 가드가 없어 서비스에 닿으면 안 된다 — tests/unit/authz/static-guards).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
