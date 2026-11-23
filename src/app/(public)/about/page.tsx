import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'one-sch 소개' };

// 공개 페이지(requirePage 없음): 구글 OAuth 동의 화면의 "애플리케이션 홈페이지".
export default function AboutPage() {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">one-sch</h1>
        <p>
          one-sch 는 팀 안에서 쓰는 프로젝트 일정 관리 도구입니다. 여러 프로젝트의 작업을 한 화면의 간트 타임라인으로 보고,
          작업 기간·진행률·의존 관계를 함께 관리합니다.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">주요 기능</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>프로젝트별로 묶은 전체 타임라인(간트), 일·주·월 보기</li>
          <li>작업과 하위 작업, 마일스톤, 진행률, 담당자 관리</li>
          <li>작업 사이 의존 관계 표시</li>
          <li>역할(관리자·멤버·뷰어)에 따른 권한과 변경 이력 기록</li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">이용 대상과 로그인</h2>
        <p>
          관리자가 허용한 사용자만 쓸 수 있습니다. Google 계정으로 로그인하며, Google 에서는 로그인 확인에 필요한 이메일 주소와
          이름, 프로필 사진만 받습니다. 자세한 내용은{' '}
          <Link href="/privacy" className="underline underline-offset-4">
            개인정보처리방침
          </Link>
          을 보세요.
        </p>
      </section>
      <p>
        <Link href="/login" className="underline underline-offset-4">
          로그인하러 가기
        </Link>
      </p>
    </>
  );
}
