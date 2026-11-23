import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOURCE, stripFontFaces, TARGET } from '../../scripts/svar-css.mjs';

describe('SVAR CSS 사본', () => {
  const generated = readFileSync(TARGET, 'utf8');

  it('커밋된 사본 = node_modules 원본 변환 결과(라이브러리를 올리면 node scripts/svar-css.mjs 다시 실행)', () => {
    expect(generated).toBe(stripFontFaces(readFileSync(SOURCE, 'utf8')));
  });

  it('@font-face·외부 url 이 없다', () => {
    expect(generated).not.toMatch(/@font-face/);
    expect(generated).not.toMatch(/url\(\s*['"]?(https?:)?\/\//i);
    expect(generated).not.toMatch(/@import/);
  });

  it('원본에는 @font-face 가 있었다(변환이 헛돌지 않음)', () => {
    expect(readFileSync(SOURCE, 'utf8')).toMatch(/@font-face/);
  });
});
