-- 3단계(이슈·댓글): 스키마 변경 없이 수기 CHECK 만 추가한다(0002·0003 과 같은 방식).
-- 서비스의 입력 검증(제목 1–200자, 설명·댓글 20,000자 이하, 댓글 본문 비우기 불가)을 DB 에서도 방어한다.
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 200);
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_description_length_check" CHECK (char_length("description") <= 20000);
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 20000);

-- 권한: 0001 의 GRANT 는 테이블 단위라 Issue·Comment 에도 이미 적용돼 있다(다시 줄 필요 없음).
