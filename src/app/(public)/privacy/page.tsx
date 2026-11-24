import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'one-sch 개인정보처리방침' };

// 공개 페이지(requirePage 없음): 구글 OAuth 동의 화면의 "개인정보처리방침 링크".
// 내용을 바꾸면 실제 수집·보관 방식(설계서 5·10절, 백업 7일, 감사 로그 1년)과 맞는지 확인한다.
export default function PrivacyPage() {
  return (
    <>
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">개인정보처리방침</h1>
        <p className="text-sm text-text-subtle">시행일: 2026년 11월 23일</p>
        <p>
          one-sch(이하 &quot;서비스&quot;)는 팀의 프로젝트 일정 관리를 위해 아래와 같이 최소한의 개인정보만 처리합니다.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">1. 처리하는 개인정보</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Google 로그인 정보:</strong> 이메일 주소, 이름, 프로필 사진 주소, Google 계정 식별자. Google 비밀번호는 받지
            않습니다.
          </li>
          <li>
            <strong>서비스 이용 정보:</strong> 역할, 마지막 로그인 시각, 로그인 세션, 사용자가 입력한 프로젝트·작업 내용과 담당자
            지정.
          </li>
          <li>
            <strong>보안 기록:</strong> 로그인 성공·실패와 데이터 변경 이력(변경 전후 값), 접속 IP 주소, 브라우저 정보(User-Agent).
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">2. 이용 목적</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>가입 신청을 받고, 승인된 사용자인지 확인하고, 로그인 상태를 유지하기 위해</li>
          <li>작업 담당자 표시 등 서비스 기능을 제공하기 위해</li>
          <li>무단 접근을 막고, 문제가 생겼을 때 변경 이력을 확인하기 위해</li>
        </ul>
        <p>광고, 마케팅, 프로필 분석에는 쓰지 않습니다.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">3. Google 사용자 데이터</h2>
        <p>
          서비스는 Google 로그인(OpenID Connect)의 기본 범위(openid, email, profile)만 요청합니다. Google 에서 받은 정보는 위 목적에만
          쓰며, 다른 곳에 팔거나 넘기지 않고, 사람이 읽어 다른 용도로 쓰지 않습니다. Gmail·Drive·캘린더 등 다른 Google 데이터에는
          접근하지 않습니다.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">4. 보관 기간과 파기</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>계정 정보: 계정을 쓰는 동안. 관리자가 계정을 정리하면 함께 지웁니다.</li>
          <li>로그인 세션: 일정 시간 쓰지 않으면 만료되고, 로그아웃하면 지웁니다.</li>
          <li>보안 기록(변경 이력·로그인 기록): 1년.</li>
          <li>백업 파일: 7일. 기간이 지나면 자동으로 지웁니다.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">5. 제3자 제공과 처리 위탁</h2>
        <p>
          개인정보를 제3자에게 제공하지 않습니다. 서비스와 데이터는 운영자가 관리하는 서버에서 처리·보관하며, 로그인 확인을 위해
          Google 과 통신하는 것 외에 외부 서비스로 보내지 않습니다.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">6. 쿠키</h2>
        <p>로그인 상태를 유지하는 세션 쿠키와 로그인 보안용 쿠키만 씁니다. 광고·분석용 쿠키는 쓰지 않습니다.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">7. 이용자의 권리</h2>
        <p>
          자신의 개인정보를 확인하거나 고치거나 지워 달라고 요청할 수 있습니다. 계정을 지우면 서비스를 더 이상 쓸 수 없습니다. Google
          계정 설정의 &quot;서드 파티 앱 및 서비스&quot;에서 이 서비스의 접근 권한을 언제든 해제할 수 있습니다.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">8. 문의</h2>
        <p>개인정보 관련 요청과 문의는 서비스 관리자에게 해 주세요.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">9. 변경</h2>
        <p>이 방침을 바꾸면 이 페이지에 시행일과 함께 알립니다.</p>
      </section>
    </>
  );
}
