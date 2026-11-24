// 클라이언트·서버 공용 입력 한도. server/auth/password.ts 와 같은 값이어야 한다.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const TITLE_MAX = 200;
export const PROJECT_NAME_MAX = 100;
/** 작업의 관련 링크·메모 길이 한도(0003 마이그레이션의 CHECK 와 같은 값) */
export const TASK_URL_MAX = 2000;
export const TASK_MEMO_MAX = 5000;
/** 이슈 설명·댓글 본문 길이 한도(0005 마이그레이션의 CHECK 와 같은 값, 설계서 9.3) */
export const ISSUE_DESC_MAX = 20000;
export const COMMENT_MAX = 20000;
/** 목록 검색어 길이 한도 */
export const SEARCH_MAX = 100;
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/**
 * 제목·이름에 둘 수 없는 문자: C0·DEL·C1 제어 문자(U+0000–U+001F, U+007F–U+009F), bidi 제어 문자(U+061C ALM,
 * U+200E·U+200F LRM/RLM, U+202A–U+202E, U+2066–U+2069), 폭 없는 문자(U+200B·U+200C, U+FEFF. U+200D ZWJ 는 결합 이모지(U+1F469 U+200D U+1F4BB 등)에 쓰여 허용), 줄·문단 구분자(U+2028, U+2029)
 */
export const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
export const UNSAFE_TEXT_MESSAGE = '제어 문자나 방향 제어 문자는 쓸 수 없습니다.';
/** 메모(여러 줄)에 둘 수 없는 문자: UNSAFE_TEXT_RE 에서 줄바꿈(LF·CR)과 탭만 뺐다. */
export const UNSAFE_MEMO_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b\u200c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;

/** http·https 로 파싱되는 절대 URL 인지(javascript:, data: 등은 거짓). 화면에서 href 에 넣기 전에도 쓴다. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
