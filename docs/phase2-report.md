# 2단계(일정) 결과 보고

| 항목 | 내용 |
|---|---|
| 브랜치 | `feat/phase2-schedule` (커밋 12개: `a559210` … 12단계) |
| 작성일 | 2026-11-23 |
| 판정 | **구현 완료, 리뷰 전** — 계획(12단계) 전부 구현. 단위·통합·E2E·lint·typecheck·build 통과. 리뷰어 3명 검토(Critical/High 0 확인)는 아직 |

## 1. 현재 상태

- 구현: 설계서 12절 2단계 — 프로젝트 CRUD(보관만, D1), 작업 CRUD(계층·마일스톤·요약 재계산), FS 의존(순환·조상 관계 거부), `/timeline` 전체 간트, `/projects` 목록, `/projects/[key]` 간트 탭, 드래그 편집과 충돌 처리, 감사 로그. 1단계 PoC 화면은 지웠다(D12).
- 쓰기는 Server Action 8개(전부 `requireRole('MEMBER')` → zod → 서비스), 읽기는 `requirePage('VIEWER')` 를 거친 Server Component 가 서비스를 직접 호출한다. 새 route handler 는 없다(`ROUTE_POLICY` 비어 있음).
- 동시성: Task·Project `version` 낙관적 잠금, 프로젝트 단위 advisory xact lock(요약 재계산·계층 검사 직렬화), 전역 의존 잠금 안 순환 재검사.
- 날짜: 서버·DTO 는 `YYYY-MM-DD` 문자열(포함 종료일)만, "오늘"은 서버가 Asia/Seoul 로 계산. SVAR 변환(로컬 자정, 배타 종료 +1/−1일)은 `src/lib/dates.ts`·`src/components/gantt/adapter.ts` 한 곳.

### 1.1 진행 내역 (커밋)

| # | 커밋 | 내용 |
|---|---|---|
| 1 | `a559210` | 설계서 정리: 7.2 requireRole, 1.3 심각도 삭제, D1–D16 을 5.2·6.1 에 반영 |
| 2 | `c87d9f4` | 마이그레이션 0002: `Project.version`, 제목·이름 길이 CHECK |
| 3 | `b58c58c` | 공용 순수 로직: 날짜, 의존·계층 그래프, 요약·지연 판정, 입력 검증 |
| 4 | `8159d1b` | 프로젝트 서비스·액션 |
| 5 | `882967a` | 작업 서비스·액션(요약 재계산 D4, 계층 D13, 연쇄 삭제 D7) |
| 6 | `31a5c41` | 의존 서비스·액션(순환 재검사, D14) |
| 7 | `df7dd02` | 정적 검사 보강: `PAGE_POLICY`, 최상위 IIFE·class static 블록 금지(D15) |
| 8 | `659401a` | SVAR 기반: 글꼴 뺀 CSS 사본, ko 로케일, 줌·열, 어댑터 |
| 9 | `a48a68b` | 읽기 서비스, `/projects` 화면 |
| 10 | `9001748` | `/timeline` 조회: 간트, 필터·줌(URL query), 보관 포함, 접기, 작업 대화상자 |
| 11 | `5ad9805` | 드래그 편집·의존 추가/삭제·충돌 처리, `/projects/[key]`, PoC 삭제, 3,000건 첫 표시 개선 |
| 12 | (이 커밋) | E2E 3개 스펙 12건, 이 보고서 |

### 1.2 화면별 동작

| 화면 | 동작 |
|---|---|
| `/projects` | 목록(보관은 뒤, 흐리게). MEMBER 이상: 만들기·수정 대화상자, 보관/보관 해제. 키는 대문자 정규화, 생성 후 변경 불가(D3) |
| `/timeline` | 프로젝트 = 요약 행(작업이 없으면 프로젝트 기간, 그것도 없으면 막대 없음, D16), 작업 = 하위 행. 일/주/월 줌, 프로젝트·담당자·상태 필터(맞는 작업 + 조상만), URL query(`project`·`assignee`·`status`·`zoom`) 보관, "보관 포함" 토글(`archived=1`, 읽기 전용, D6), 모두 접기/펼치기, 오늘 열 강조(일 줌), 지연 막대 빨간 테두리(D11) |
| `/projects/[key]` | 그 프로젝트만 보이는 같은 간트(D9). 탭은 "간트" 하나(보드·목록·이슈는 3단계). 없는 키·형식이 틀린 키는 404 |
| 작업 대화상자 | "작업 추가" 단추·막대/행 더블클릭으로 연다(MEMBER 이상, 보관 프로젝트 제외). 상위 작업 후보는 같은 프로젝트·마일스톤 아님·자기와 하위 제외. 하위가 있으면 기간·진행률 입력을 막는다(D4). 삭제는 한 번 더 확인(하위 개수 표시, D7). 선행·후행 의존 목록과 삭제 단추 |
| 드래그 | 이동·끝 늘이기·진행률. 놓을 때 바뀐 필드만 `updateTask`. 실패하면 이전 값으로 되돌리고 메시지, CONFLICT·NOT_FOUND 면 `router.refresh()` 로 최신 값. 프로젝트 행·요약 행·보관 프로젝트·저장 중인 막대는 끌 수 없다 |
| 의존 | 막대의 오른쪽 점 → 다른 막대의 왼쪽 점(FS). 클라이언트 사전 검사(FS 만·자기·프로젝트 행·보관·조상 관계·중복·순환) 뒤 서버가 잠금 안에서 다시 검사. 성공하면 임시 링크를 서버 id 로 바꾸고, 실패하면 지운다 |

## 2. 확정 결정 D1–D16 반영

| # | 결정 | 반영 위치 |
|---|---|---|
| D1 | 프로젝트는 보관/보관 해제만, 실제 삭제 없음 | `project-service.setProjectArchived`, `/projects` |
| D2 | `Project.version` 추가 | 마이그레이션 0002, 프로젝트 수정·보관의 CONFLICT |
| D3 | 키 변경 불가 | `updateProjectSchema` 에 key 없음, 대화상자 편집 모드에 키 입력 없음 |
| D4 | 하위가 있는 상위의 기간·진행률은 같은 트랜잭션에서 조상까지 재계산해 저장, 직접 편집·드래그 불가 | `task-service.recalcAncestors`, 대화상자 입력 비활성, 간트 intercept |
| D5 | FS 는 표시만(일정 강제 없음) | 의존은 화살표만 |
| D6 | 보관 프로젝트의 작업은 읽기 전용(CONFLICT `archived`), 타임라인 기본 숨김 + 보관 포함 토글 | 서비스 `ensureWritableProject`, `loadTimeline({includeArchived})`, 간트 intercept |
| D7 | 하위가 있는 작업 삭제는 확인 후 연쇄 삭제, 감사 스냅샷 | `deleteTask`(DB cascade, before 에 하위·의존 목록), 대화상자 확인 단계 |
| D8 | 담당자·책임자 후보는 활성 사용자 전원, id·이름만 | `listUserOptions` |
| D9 | `/projects` + `/projects/[key]` 간트 탭 | 9·11단계 |
| D10 | 행 순서 드래그·SVAR 내장 편집기 범위 밖 | `add-task`·`delete-task`·`move-task`·`copy-task`·`indent-task` intercept 로 차단, `show-editor` 는 자체 대화상자로 |
| D11 | 지연 = `endDate < 오늘(Seoul) AND status != DONE`, 요약 행 제외 | `rollup.isLate`, 막대 `data-late` |
| D12 | PoC 삭제 | `src/app/poc/**`, docker-compose·Playwright 의 `ENABLE_POC`, 설계서 10.1 표 행 삭제, `docs/gantt-poc.md` 에 "2단계 처리" 추가 |
| D13 | 같은 프로젝트 안에서만 상위 변경, 자기 후손 밑 불가, 깊이 최대 5 | `task-service.checkParent` |
| D14 | 조상·후손 사이 의존 거부 | `dependency-service`, 클라이언트 `validateLink` |
| D15 | page 정책 표·IIFE/static 검사만 추가 | `tests/unit/authz/page-policy.ts`(`/projects/[key]` 추가, PoC 항목 삭제), `static-guards.test.ts` |
| D16 | 작업 없는 프로젝트는 프로젝트 기간으로 요약 막대 | `adapter.projectToRow`, 기간도 없으면 막대 숨김(`.og-unscheduled`) |

## 3. 테스트 결과 (2026-11-23, NAS · Playwright 컨테이너)

| 항목 | 결과 |
|---|---|
| typecheck · lint | 통과 |
| 단위(vitest unit) | **27파일 301건 통과**. `--sequence.shuffle`: 27파일 301건 통과 |
| 통합(vitest integration, onesch_test) | **10파일 96건 통과**(약 56–65초). `--sequence.shuffle`: 10파일 96건 통과(77초) |
| E2E(Chromium, onesch_e2e) | **전체 26건 통과**(2단계 신규 12건 포함, 2.9분). 신규 3개 스펙 `--repeat-each=3`: 36건 통과(4.3분, 3,000건 첫 표시 644–772ms) |
| build(`npm run build`) | 통과(`/timeline` First Load JS 143kB, `/projects/[key]` 214kB) |
| 운영 의존성 `npm audit --omit=dev` | 취약점 0건 |

### 3.1 E2E 시나리오(계획 4.3) 대응

| # | 시나리오 | 스펙 | 결과 |
|---|---|---|---|
| 1 | `/projects` 생성 → 목록·타임라인 → 수정 → 보관하면 사라짐(보관 포함이면 다시 보임) | `projects.spec.ts` | 통과 |
| 2 | 작업·하위·마일스톤 대화상자 생성, YYYY-MM-DD 열, 부모 요약 막대가 하위를 감쌈 | `timeline.spec.ts` | 통과 |
| 3 | +3일 이동, 끝 +2일, 새로고침 후 DB·화면 유지, 감사 `task.update` 2건 | `timeline.spec.ts` | 통과 |
| 4 | 충돌(ownerDb 로 version·날짜 변경 후 드래그) → 충돌 메시지, 최신 값 표시, DB·감사 불변 | `timeline.spec.ts` | 통과(아래 3.2 참고) |
| 5 | 링크 추가 → 새로고침 후 유지, 역방향 순환 거부·DB 불변, 대화상자에서 삭제 | `timeline.spec.ts` | 통과 |
| 6 | VIEWER: 화면은 보이고 추가·수정 단추 없음, 드래그·더블클릭해도 DB 불변, 링크 점 없음 | `timeline-authz.spec.ts` | 통과 |
| 6+ | MEMBER: 보관 프로젝트 드래그 거부, 하위가 있는 상위 막대 드래그 거부·입력 비활성, 없는 키 404 | `timeline-authz.spec.ts` | 통과 |
| 7 | 줌 일/주/월, 프로젝트·담당자·상태 필터(URL 유지·새로고침 유지), 접기/펼치기 | `timeline.spec.ts` | 통과 |
| 8 | `/timeline` CSP 위반 0, 외부·글꼴 요청 0 | `timeline.spec.ts` | 통과 |
| 9 | `timezoneId: America/Los_Angeles` 에서 표시 날짜 = DB, 막대 위치(10칸·5칸) 일치, 드래그 저장 날짜 정확 | `timeline.spec.ts` | 통과 |
| 10 | 3,000건(10개 프로젝트 × 상위 60 + 하위 240, 의존 590) 첫 표시 | `timeline.spec.ts` | 통과(아래 3.3) |

### 3.2 시나리오 4 의 한계

충돌 시 클라이언트는 이전 값으로 되돌린 직후 `router.refresh()` 를 부르므로, "드래그 전 자리로 돌아온 순간"은 화면에 거의 남지 않는다. 테스트는 (1) 충돌 메시지, (2) 최종 막대 위치가 **DB 의 최신 값 자리**(기준 막대 대비 10칸)이고 드래그한 자리(+2칸)가 아님, (3) DB 날짜·version·감사 불변을 확인한다. "원위치" 자체를 따로 관찰하지는 않는다.

### 3.3 3,000건 첫 표시 (N-01)

측정: 페이지 이동 시작 → 간트 마운트 후 실제 행을 넘기고 두 번째 프레임(`data-ready-ms`, `performance.now()`). 브라우저와 서버(`next start`)가 **같은 NAS 컨테이너**에서 돈다(실제 사용자 PC 보다 느린 조건). Playwright 선택자 폴링이 측정에 끼지 않게 고정 대기 후 한 번 읽는다.

| 조건 | 3회 측정(ms) | 구간(대표값) |
|---|---|---|
| 처음 구현 | 2,680 · 4,132 · 3,953 | 막대 3,010개·DOM 53,384개를 모두 그림 |
| 테마 div 높이 수정 후 | 2,276 · 2,206 · 2,326 | DOM 537개로 줄었으나 첫 렌더에서 왼쪽 표가 3,000행을 다 그림(레이아웃 트리 31,930개, 725ms) |
| **최종**(빈 데이터로 먼저 띄운 뒤 다음 프레임에 행 전달) | **748 · 647 · 718**(전체 E2E 실행), 731 · 676 · 635(단독) | TTFB 약 250ms, HTML 160KB(전송), DCL 약 470ms, 마운트 약 600ms |

원인 두 가지를 고쳤다(`src/components/gantt/gantt.css`, `gantt-chart.tsx`).
1. `<Willow>` 와 Gantt 가 만드는 `.wx-theme` div 두 겹에 높이가 없어 간트가 내용 높이(3,000행)만큼 늘어나 행 가상화가 꺼져 있었다 → `.og-gantt .wx-theme { height: 100% }`.
2. SVAR 표는 자기 높이를 재기 전 첫 렌더에서 모든 행을 그린다 → 첫 프레임은 빈 데이터로 띄우고 다음 프레임에 실제 행을 넘긴다.

## 4. 계획과 달라진 점

| 항목 | 계획 | 실제 | 이유 |
|---|---|---|---|
| 서버 값 다시 반영(3.8) | 명시적 refresh 때 revision 키로 Gantt 다시 마운트 | 다시 마운트하지 않는다. 새 서버 값이 오면 클라이언트 사본(`TimelineStore`)을 새로 만들고 `tasks` prop 을 바꿔 SVAR 가 다시 읽게 한다(SVAR `init` 이 스크롤·레이아웃을 보존). 줌·필터·접힘은 React 상태·사본에 남는다 | 다시 마운트하면 이벤트 처리기 재등록·3,000건 재마운트 비용이 든다 |
| 구조 변경 반영 | 액션 결과를 `exec` 로 반영 | 드래그·링크는 `exec`, 대화상자(추가·수정·삭제·의존 삭제)는 사본을 고친 뒤 행을 다시 만든다 | 추가·삭제·상위 변경은 트리 위치가 바뀌어 `exec` 로 맞추기 번거롭고 틀리기 쉽다 |
| 파일 위치 | `timeline-view.tsx`·`task-form-dialog.tsx` 는 `app/(main)/timeline/` | 그대로 두고 `/projects/[key]` 가 상대 경로로 재사용. SVAR 를 그리는 부분(`gantt-chart.tsx`)과 클라이언트 사본(`timeline-store.ts`)은 `src/components/gantt/` | dynamic(ssr:false) 경계를 SVAR 부분만으로 좁힘 |
| 의존 삭제 UI | `delete-link` intercept | 구현(막대의 삭제 단추 → 서버 삭제 후에만 화면에서 제거) + 작업 대화상자의 의존 목록 삭제. E2E 는 대화상자 경로만 | SVAR 링크 선택·삭제 단추는 좌표 의존이 커서 E2E 가 불안정할 수 있다 |
| `ENABLE_POC` 의 `.env.example` 정리 | 삭제 | 해당 없음 — 저장소의 `.env.example` 이 **빈 파일**(0바이트)이다 | 1단계 보고서 2.1 의 설명과 다르다(아래 7) |
| E2E 10 `*.busy` 로그 확인 | 확인 | 하지 않음 | 읽기 전용 화면이라 쓰기 잠금 대기가 없다. 연결 풀 고갈은 6절 위험으로 남김 |

## 5. 남은 작업·범위 밖

- 리뷰어 3명(보안·로직·테스트) 검토와 수정(계획 4.4).
- 3단계: 보드·목록·이슈 탭, 마크다운 raw HTML 비허용, 행 순서 드래그(D10).
- 5단계·운영: db `cap_add` 축소, 감사 로그 보관 절차.
- 주·월 줌의 오늘 선(지금은 일 줌의 열 강조만, `docs/gantt-poc.md` 반영 사항 7).
- DTO 압축(3,000건 HTML 160KB 전송). 지금 수치로는 필요 없음.
- 실제 사용자 PC·운영 이미지(amd64)에서의 3,000건 측정.

## 6. 수용한 위험

- **다른 사용자의 변경은 새로고침 전까지 보이지 않는다.** 작업·의존 액션은 `revalidatePath` 를 부르지 않는다(2단계 5·6번 커밋의 결정: 응답마다 수천 건을 다시 읽지 않으려고). 덮어쓰기는 version 충돌(CONFLICT → 최신 값 다시 읽기)로 막는다.
- **상위 요약 재계산(D4)으로 조상 version 이 자주 오른다.** 상위 작업 편집이 충돌할 수 있다. 액션 결과로 조상 version 을 즉시 반영하고, 충돌이면 최신 값을 다시 읽는다.
- **클라이언트 링크 사전 검사는 화면에 있는 의존만 본다**(숨긴 보관 프로젝트에 걸친 의존은 모름). 최종 판정은 서버가 전역 의존 잠금 안에서 한다.
- 간트 첫 프레임은 빈 차트다(다음 프레임에 행이 들어온다). 체감 영향은 없다고 판단.
- 마일스톤 마름모는 그 날의 시작(0시) 경계에 그려진다(SVAR 기본). 날짜 열에는 정확한 날짜가 표시된다.
- 대화상자의 날짜 입력은 브라우저 언어 형식으로 보일 수 있다(`<input type=date>`). 저장·표시 값은 `YYYY-MM-DD`.
- `style-src 'unsafe-inline'` 유지(SVAR·막대 색 인라인 스타일) — 1단계와 같음.
- DB 연결 풀(5개): 일정 쓰기는 프로젝트 잠금으로 줄을 서므로, 같은 프로젝트에 동시 저장이 몰리면 대기한다(트랜잭션 maxWait 5초). 로그인 RATE_LIMITED 로 번질 수 있음 — 1단계 위험과 같이 `*.busy` 로그로 감시.

## 7. 확인이 필요한 것

- `.env.example` 이 저장소에 빈 파일로 커밋돼 있다(`git show HEAD:.env.example` 0바이트). 1단계 보고서 2.1 은 운영 키를 값 없이 둔다고 적었다. 의도인지 확인 필요(이번 단계에서는 고치지 않음).
