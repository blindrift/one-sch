-- 2단계(일정): 프로젝트 편집에도 작업과 같은 낙관적 잠금(version)을 쓴다(결정 D2).
ALTER TABLE "Project" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- 수기 추가: 서비스의 입력 검증(제목 1–200자, 프로젝트 이름 1–100자)을 DB 에서도 방어한다.
ALTER TABLE "Task" ADD CONSTRAINT "Task_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 200);
ALTER TABLE "Project" ADD CONSTRAINT "Project_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 100);

-- 권한: 0001 의 GRANT 는 테이블 단위라 새 컬럼에도 그대로 적용된다(다시 줄 필요 없음).
