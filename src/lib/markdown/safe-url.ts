// 마크다운 링크 주소 허용 목록(설계서 5.2 마크다운, D23). react-markdown 의 urlTransform 으로 쓴다.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * http·https·mailto 절대 주소만 정규화한 값(URL.href)으로 돌려주고, 나머지는 빈 문자열.
 * WHATWG URL 파서는 브라우저와 같이 앞뒤 공백·제어 문자를 지우고 탭·줄바꿈을 빼고 읽으므로
 * `java\tscript:`·` JAVASCRIPT:`·`&#106;avascript:`(마크다운 파서가 풀어 준 뒤) 같은 변형도 프로토콜로 걸러진다.
 * 상대 주소·앵커(`/x`, `#a`)는 파싱이 실패해 지운다(이 앱의 마크다운에는 필요 없다).
 */
export function safeMarkdownUrl(value: string): string {
  try {
    const u = new URL(value);
    return ALLOWED_PROTOCOLS.has(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}
