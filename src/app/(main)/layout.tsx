// 화면 틀(사이드바·상단 바)은 각 page 가 requirePage 뒤에 AppShell 로 그린다.
// layout 은 가드가 없어 프로젝트 목록(서비스)을 읽을 수 없기 때문이다(tests/unit/authz/static-guards).
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return children;
}
