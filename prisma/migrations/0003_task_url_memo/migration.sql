-- 작업의 관련 링크(url, 하나)와 메모(memo, 여러 줄 평문). 기존 행은 NULL.
ALTER TABLE "Task" ADD COLUMN "url" TEXT;
ALTER TABLE "Task" ADD COLUMN "memo" TEXT;

-- 수기 추가: 서비스의 입력 검증(url 2000자, memo 5000자, 빈 문자열은 NULL 로 저장)을 DB 에서도 방어한다(0002 와 같은 방식).
ALTER TABLE "Task" ADD CONSTRAINT "Task_url_length_check" CHECK (char_length("url") BETWEEN 1 AND 2000);
ALTER TABLE "Task" ADD CONSTRAINT "Task_memo_length_check" CHECK (char_length("memo") BETWEEN 1 AND 5000);

-- 권한: 0001 의 GRANT 는 테이블 단위라 새 컬럼에도 그대로 적용된다(다시 줄 필요 없음).
