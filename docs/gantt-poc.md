# 간트 라이브러리 PoC 결과 — SVAR React Gantt (MIT)

| 항목 | 내용 |
|---|---|
| 대상 | `@svar-ui/react-gantt` 2.8.3 (MIT), `@svar-ui/react-core` 2.6.2 |
| 일시 | 2026-11-20 |
| 화면 | `/poc/gantt?n=<작업 수>` — ADMIN 이고 `ENABLE_POC=true` 일 때만 (운영 기본 false) |
| 측정 | `next build` + `next start`, Playwright Chromium(헤드리스, 1600×1000), 개발 PC(macOS arm64) |

## 결론

**채택.** 채택 기준(그룹·드래그·의존·줌 동작 + 오늘 선 대안 가능)을 모두 만족한다. 2단계에서 아래 "2단계 반영 사항"을 지켜 붙인다.

## 확인 항목

| # | 항목 | 결과 | 근거·방법 |
|---|---|---|---|
| 1 | 프로젝트 그룹(summary + parent, 접기) | 동작 | 프로젝트를 `type:'summary'`, 작업을 `parent` 로 둠. `open-task` 로 접으면 보이는 막대 165 → 113 |
| 2 | 요약 자동 계산 | MIT 에 없음(PRO) → **서버 계산값 표시로 대체 확인** | `computeSummaries()`(최소 시작~최대 종료, 기간 가중 진행률). 하위 작업 저장 후 부모를 `update-task`(eventSource 'poc')로 갱신. 요약 막대 직접 편집은 `intercept('update-task')` 로 거부 |
| 3 | 드래그 이동·리사이즈·진행률 | 동작 | 이동 +3일, 오른쪽 끝 리사이즈 +2일, 진행률 52→64%. 드래그 중에는 `inProgress:true`, 놓을 때 한 번만 `update-task`(inProgress 없음) |
| 3-1 | 저장 실패 시 원위치 | 동작 | "저장 실패 흉내" 후 드래그 → `api.exec('update-task', 이전 값)` 으로 되돌림(막대 x 좌표가 이전 값으로 복귀) |
| 4 | 의존 추가·삭제, 순환 거부 | 동작 | `intercept('add-link')` 에서 FS(`e2s`) 아닌 링크 거부, `createsCycle()` 이 참이면 거부. `on('add-link'/'delete-link')` 로 저장 지점 확보 |
| 5 | 일·주·월 줌 | 동작 | `scales`·`cellWidth` 를 바꿔 전환. 머리글 `2026년 11월` / `11/15~` / `2026년`·`11월` |
| 6 | 오늘 선 | MIT 에 vertical marker 없음(PRO) → **`highlightTime` 대안 확인** | 오늘 날짜 열에 클래스 부여(배경 + 왼쪽 2px 선). 일 단위 줌에서만 표시 |
| 7 | 프로젝트 색·지연 테두리 | 동작(모양은 다듬기 필요) | `taskTemplate` 로 색·빨간 테두리(종료일 경과 + 진행률<100) 표시, 300건 중 15개 지연. 템플릿 내용이 진행률 채움 뒤에 놓여 글자가 잘림 → 2단계는 CSS(막대 배경)로 색을 주고 템플릿은 글자만 |
| 8 | 한국어 | 동작(로케일 직접 작성) | 공식 로케일은 en·cn 뿐. `<Locale words={ko}>` 가 기본 위에 덮어쓰므로 쓰는 키만 정의(`src/app/poc/gantt/ko.ts`) |
| 9 | `lengthUnit:'day'`·inclusiveEnd 와 `@db.Date` | **변환 필요** | SVAR 내부 `end` 는 배타적(다음 날 0시)이다. 시작=종료=11/20 을 넣으면 duration 0, 11/20~11/22 는 duration 2. `inclusiveEnd` 는 표시용일 뿐 → DB(포함 종료일) → SVAR 는 `end + 1일`, 저장 시 `end - 1일`. 마일스톤은 `type:'milestone'` 으로 따로 |
| 10 | CSP 위반 | 스크립트 위반 0. **글꼴 요청 12건 차단(기능 영향 없음)** | 번들에 `eval`/`new Function` 없음. `<Willow fonts={false}>` 로 CDN 아이콘 CSS 요청은 없앰. 남은 것은 `react-core` CSS 의 `@font-face`(cdn.svar.dev) — CSS 를 불러오는 순간 요청되어 CSP 가 막는다(글꼴은 쓰지 않으므로 화면 영향 없음, 콘솔 오류만) |
| 11 | `ssr:false` 하이드레이션 경고 | 없음 | `next dev` 에서 콘솔 error/warning 0(위 글꼴 CSP 메시지 제외) |
| 12 | 3,000건 2초 이내 | **통과** | 컴포넌트 마운트 → 두 번째 rAF 까지 290~305ms(3,000건), 253~383ms(300건). 3,000건 휠 스크롤 반응 ~150ms |

## 2단계 반영 사항

1. **날짜 변환 계층**: 서버 DTO(`YYYY-MM-DD`, 포함 종료일) ↔ SVAR(`Date`, 배타 종료일) 변환 함수를 한 곳에 두고 단위 테스트한다. 로컬 자정 기준(TZ=Asia/Seoul)으로 만든다.
2. **SVAR CSS 의 `@font-face` 제거**: `react-core` CSS(=all.css 에 포함)가 cdn.svar.dev 글꼴을 선언한다. 빌드 때 `@font-face` 를 뺀 사본을 만들어 import 하는 스크립트(예: `scripts/svar-css.mjs`, `predev`/`prebuild`)로 CSP 콘솔 오류를 없앤다. CSP 에 cdn.svar.dev 를 추가하지 않는다.
3. **테마 글꼴·아이콘 대체**(이번 PoC 에서 `globals.css` 에 반영): 앱 글꼴 스택에서 Roboto 등 웹 글꼴 이름을 빼고, SVAR 글꼴 변수와 단축형 글꼴 변수(`--wx-grid-*-font` 등)를 앱 글꼴로 덮어쓰며, 쓰는 아이콘(`wxi-menu-*`, `wxi-angle-*`)만 문자로 대신한다. 편집기·메뉴를 쓰면 필요한 아이콘을 더 정의한다.
4. **열 정의**: 기본 열은 날짜를 `DD-MM-YYYY` 로 보여 준다. `columns` 를 직접 정의(작업·담당자·기간·진행률, `YYYY-MM-DD`)한다.
5. **저장 흐름**: `intercept('update-task')` 는 검증·요약 막대 거부만, 실제 저장은 `on('update-task')` 에서 `inProgress` 가 아닐 때 Server Action 호출 → 실패·`CONFLICT` 면 이전 값으로 `exec('update-task', {eventSource:'server'})`. 의존 추가는 서버에서도 순환 검사를 다시 한다(클라이언트 검사는 UX 용).
6. **요약 막대**: 서버가 계산한 값으로 표시하고 직접 편집은 막는다.
7. **오늘 선**: `highlightTime` 은 일 단위 줌에서만 의미가 있다. 주·월 줌에서도 필요하면 차트 영역에 절대 위치 오버레이를 덧그린다.
8. PoC 의 `window.__ganttApi` 노출은 PoC 화면 전용이며 2단계 코드로 옮기지 않는다.

## 재현

```sh
ENABLE_POC=true npm run dev   # ADMIN 으로 로그인 후 /poc/gantt?n=3000
```

DB 없이 측정할 때는 가드 없는 임시 하네스 페이지(`/poc-harness`)와 Playwright 스크립트를 썼고, 측정 후 삭제했다(커밋하지 않음).
