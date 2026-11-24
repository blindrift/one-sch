import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/markdown';

const html = (md: string) => renderToStaticMarkup(createElement(Markdown, null, md));

describe('Markdown(서버 렌더)', () => {
  it('기본 문법과 GFM(표·체크리스트·취소선)', () => {
    const out = html('# 제목\n\n**굵게** ~~취소~~\n\n- [x] 끝\n- [ ] 할 일\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('<h1>제목</h1>');
    expect(out).toContain('<strong>굵게</strong>');
    expect(out).toContain('<del>취소</del>');
    expect(out).toContain('<table>');
    expect(out).toContain('<td>1</td>');
    expect(out).toMatch(/<input type="checkbox" disabled="" checked=""\/>/);
  });

  it.each([
    ['script 태그', '<script>alert(1)</script>'],
    ['onerror 속성', '<img src=x onerror="alert(1)">'],
    ['iframe', '<iframe src="https://evil.example"></iframe>'],
    ['인라인 HTML 안 이벤트', '안녕 <b onclick="alert(1)">x</b>'],
    ['svg onload', '<svg onload="alert(1)"></svg>'],
  ])('raw HTML(%s)은 출력하지 않는다(앞뒤 글은 남는다)', (_label, md) => {
    const out = html(`앞 문장\n\n${md}\n\n뒤 문장`);
    expect(out).not.toMatch(/<script|<iframe|<svg|<b |onerror|onclick|onload|<img/i);
    // 대조: 렌더가 통째로 비어서 통과한 것이 아님
    expect(out).toContain('<p>앞 문장</p>');
    expect(out).toContain('<p>뒤 문장</p>');
  });

  it.each([
    '[x](javascript:alert(1))',
    '[x](JAVASCRIPT:alert(1))',
    '[x](  javascript:alert(1))',
    '[x](java%0ascript:alert(1))',
    '[x](&#106;avascript:alert(1))',
    '[x](javascript&colon;alert(1))',
    '[x](data:text/html,<script>alert(1)</script>)',
    '[x](vbscript:msgbox(1))',
    '<javascript:alert(1)>',
    '[x][r]\n\n[r]: javascript:alert(1)',
    '[x](&#x6A;avascript:alert(1))',
    '[x](&#X6a;avascript&#x3A;alert(1))',
    '[x](javascript:alert(1) "제목")',
    "[x](<javascript:alert(1)> 'title')",
    '[x](https://bank.example@evil.example/)',
  ])('위험한 링크 %j 는 href 없이 글자만', (md) => {
    const out = html(`보기 ${md} 끝`);
    // 대조: 주변 글과 링크 글자는 남는다
    expect(out).toContain('보기 ');
    expect(out).toContain(' 끝');
    // 링크 요소·주소 속성이 없다(링크 글자 자체는 남을 수 있다: 자동 링크 <javascript:…> 는 글자가 곧 주소)
    expect(out).not.toMatch(/<a\b|href=|src=/i);
  });

  it('안전한 링크는 새 창 + rel noopener noreferrer nofollow, 자동 링크(GFM)도', () => {
    const out = html('[문서](https://example.com/a?b=1) 그리고 https://example.org 와 <mailto:a@example.com>');
    expect(out).toContain('<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer nofollow">문서</a>');
    expect(out).toContain('<a href="https://example.org/" target="_blank" rel="noopener noreferrer nofollow">https://example.org</a>');
    expect(out).toContain('href="mailto:a@example.com"');
  });

  it('이미지는 img 없이 링크로 바꾼다(위험한 주소는 글자만)', () => {
    const out = html('![그림](https://example.com/x.png) ![](javascript:alert(1)) ![추적](data:image/png;base64,AAAA)');
    expect(out).not.toContain('<img');
    expect(out).toContain('<a href="https://example.com/x.png" target="_blank" rel="noopener noreferrer nofollow">[그림]</a>');
    expect(out).toContain('<span>[이미지]</span>');
    expect(out).toContain('<span>[추적]</span>');
  });

  it('코드 블록 안의 HTML 은 글자로 이스케이프된다', () => {
    const out = html('```\n<script>alert(1)</script>\n```');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });
});
