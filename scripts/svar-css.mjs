#!/usr/bin/env node
// SVAR Gantt 의 전체 CSS(@svar-ui/react-gantt/all.css)에서 @font-face 블록(cdn.svar.dev 글꼴)을 뺀 사본을 만든다.
// CSP(font-src 'self')가 그 글꼴 요청을 막아 콘솔 오류가 나므로, 앱은 원본 대신 이 사본을 import 한다.
// 사본은 커밋한다(Dockerfile 이 next build 를 직접 불러 prebuild 훅이 돌지 않는다). 라이브러리를 올리면 다시 실행한다:
//   node scripts/svar-css.mjs
// tests/unit/svar-css.test.ts 가 사본 = 원본 변환 결과인지, 외부 url 이 없는지 확인한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'node_modules/@svar-ui/react-gantt/dist-full/index.css';
export const TARGET = 'src/components/gantt/svar.css';
export const HEADER = '/* 생성 파일: scripts/svar-css.mjs 가 @svar-ui/react-gantt/all.css 에서 CDN 글꼴 선언(font-face)을 뺀 사본. 직접 고치지 않는다. */\n';

/** @font-face { ... } 블록을 모두 지운다(블록 안에 중괄호가 없다는 전제 — 테스트가 결과를 검사한다). */
export function stripFontFaces(css) {
  return HEADER + css.replace(/@font-face\s*\{[^{}]*\}/g, '');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(TARGET, stripFontFaces(readFileSync(SOURCE, 'utf8')));
  console.log(`${TARGET} 생성`);
}
