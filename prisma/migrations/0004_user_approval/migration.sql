-- 구글 첫 로그인 가입 신청(승인 대기)·거부. 기존 사용자는 모두 APPROVED.
CREATE TYPE "UserApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "User" ADD COLUMN "approval" "UserApproval" NOT NULL DEFAULT 'APPROVED';

-- 수기 추가: 승인되지 않은 사용자는 활성일 수 없다(로그인·세션·담당자 목록이 active 만 보므로 DB 에서도 막는다).
ALTER TABLE "User" ADD CONSTRAINT "User_approval_active_check" CHECK ("approval" = 'APPROVED' OR "active" = false);

-- 권한: 0001 의 GRANT 는 테이블 단위라 새 컬럼에도 그대로 적용된다.
