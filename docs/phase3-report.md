# 3단계(이슈·보기) 결과 보고

| 항목 | 내용 |
|---|---|
| 브랜치 | `feat/phase3` (커밋 12개: `67e8cd2` … 12단계) |
| 작성일 | 2026-11-24 |
| 판정 | **리뷰 전 초안** — 계획 12단계 구현·검증 완료, 리뷰(8절)는 리더가 채운다 |

## 1. 현재 상태

- 구현: 설계서 12절 3단계 — 이슈·댓글(쓰기·읽기), 프로젝트 탭(간트·보드·목록·이슈), 전체 이슈 `/issues`, 상세 패널(`?issue=KEY-n`), 마크다운, 칸반 보드(작업|이슈), 목록 탭의 행 순서 바꾸기(D17).
- 쓰기 Server Action 7개 추가: `issue.createIssue/updateIssue/deleteIssue`(MEMBER), `comment.addComment/updateComment/deleteComment`(VIEWER, 본인·ADMIN 판정은 서비스), `task.reorderTask`(MEMBER). 모두 `requireRole` → zod → 서비스(`$transaction(SCHEDULE_TX)` + `lockProject` + version + `writeAudit`). 새 route handler 없음.
- 새 page 4개(`/projects/[key]/{board,list,issues}`, `/issues`) 모두 `requirePage('VIEWER')`, `PAGE_POLICY` 반영.
- 새 의존성(D19, 정확한 버전): `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2, `react-markdown` 10.1.0, `remark-gfm` 4.0.1.
- 마이그레이션 `0005_issue_checks`: CHECK 3개만(스키마 변경 없음).

### 1.1 진행 내역 (커밋)

| # | 커밋 | 내용 |
|---|---|---|
| 1 | `67e8cd2` | 설계서: D10 개정(D17), 5.2 Issue·Comment·마크다운 규칙, 6.1.1 보드·목록·이슈, 결정 D17–D23. 2단계 보고서 5절 문구 정정 |
| 2 | `9e98eba` | 마이그레이션 0005(Issue 제목 1–200·설명 ≤20,000, Comment 본문 1–20,000) + db-permissions 테스트 |
| 3 | `33a9a5d` | 공용 순수 로직: `lib/issue/status.ts`, `validation/{issue,comment}.ts`, `limits.ts`, `lib/list-query.ts`, `lib/markdown/safe-url.ts` |
| 4 | `28d010f` | `issue-service` + `actions/issue.ts`, `ensureWritableProject` 를 `schedule-dto` 로 공용화 |
| 5 | `49d68e0` | `comment-service` + `actions/comment.ts` |
| 6 | `e3d2133` | 읽기: `issue-query-service`(목록·상세·이슈 보드), `task-list-service` + `lib/task-list.ts`, `lib/board.ts` |
| 7 | `28e3c5e` | 탭 라우팅, `project-header.tsx`(ProjectTitle·ProjectTabs), `ViewTabs` 링크화, 사이드바 이슈 메뉴 |
| 8 | `ecdb79e` | 목록 탭(필터·검색·정렬·페이지 URL, 작업 대화상자 재사용) |
| 9 | `8c00b41` | 이슈 탭·`/issues`·상세 패널·댓글·`components/markdown.tsx`·`ui/textarea`, 정적 검사(HTML 주입 금지), 의존성 설치 |
| 10 | `39b4f20` | 보드 탭(dnd-kit, 마우스·키보드, 낙관 이동·롤백) |
| 11 | `7f29df3` | 행 순서 `reorderTask` + 목록 탭 sortable |
| 12 | (이 커밋) | E2E 3개 스펙 16건, 행 순서 기준 보정(`siblingAnchor`), 목록 끌기 안내 문구 한국어화, 이 보고서 |

### 1.2 화면별 동작

| 화면 | 동작 |
|---|---|
| 프로젝트 탭 | 간트(`/projects/KEY`)·보드·목록·이슈 링크, 현재 탭 `aria-current=page`. 사이드바 프로젝트 항목은 하위 탭에서도 활성(키 접두 충돌 `AB`/`ABC` 제외). 없는 키·형식 틀린 키 404 |
| 목록 | 작업 표(간트와 같은 계층 순서, 상위 경로, 지연 표시). 정렬 머리 링크(순서·제목·상태·시작·종료·진행률), 상태·담당자 필터, 제목 검색, 50건 페이지 — 모두 URL query. MEMBER 는 행을 눌러 작업 대화상자로 수정. 정렬 "순서"·필터·검색 없음일 때 손잡이로 형제 순서 변경(마우스·키보드) |
| 보드 | 상태 열. `?kind=issue` 로 이슈 보드. 작업은 기본으로 하위 없는 작업·마일스톤, `?parents=1` 로 상위 포함. 열 안은 종료일(이슈는 마감일, 없으면 뒤) 순. 끌면 낙관 이동 → 저장, 실패 시 되돌리고 메시지, CONFLICT·NOT_FOUND 면 `router.refresh()`. 키보드: Space 들기 → ←/→ 열 이동 → Space 놓기, Esc 취소, Enter 카드 열기 |
| 이슈 탭·`/issues` | 목록(상태·유형·우선순위·담당자 필터, `/issues` 는 프로젝트 필터도, 정렬, 제목 또는 `KEY-번호` 검색, 50건 페이지). 행을 누르면 오른쪽 상세 패널(`?issue=KEY-n`, 새로고침·공유 유지). `/issues` 는 보관 프로젝트를 기본으로 빼고, 프로젝트 필터로 고르면 읽기 전용으로 보인다 |
| 상세 패널 | 서버 렌더. 메타(상태·우선순위·담당·보고자·마감·연결 작업·프로젝트), 설명·댓글 마크다운, MEMBER 수정·삭제(삭제 확인), 댓글 작성(VIEWER 이상)·본인 수정·본인/ADMIN 삭제. 보관 프로젝트는 단추·입력 없음 |

## 2. 결정 D17–D23 반영

| # | 결정 | 반영 위치 |
|---|---|---|
| D17 | 행 순서는 목록 탭에서만, 형제끼리 | `task-service.reorderTask`, `lib/schedule/reorder.ts`, `list/task-list-view.tsx`. 간트 `BLOCKED_ACTIONS` 그대로 |
| D18 | 보관 프로젝트 이슈·댓글 읽기 전용 | 서비스 `ensureWritableProject`(이슈·댓글 쓰기 모두 잠금 안), 화면 단추 숨김 |
| D19 | 의존성 정확한 버전 | `package.json`, audit 0 |
| D20 | 보드 범위·열 순서 | `lib/board.ts` |
| D21 | 댓글 권한·이슈 삭제 | `comment-service`, `issue-service.deleteIssue`(before 에 스냅샷·`commentCount`·`deletedCommentCount`) |
| D22 | 번호 발급 | `issue-service.nextIssueNumber`: 잠금 안 raw `UPDATE … RETURNING "issueSeq"`(Project.version·updatedAt 불변) |
| D23 | 마크다운 규칙 | `components/markdown.tsx`(`server-only`, `skipHtml`, `urlTransform=safeMarkdownUrl`, img → 링크), 정적 검사 |

## 3. 테스트 결과 (2026-11-24, NAS · Playwright 컨테이너)

| 항목 | 결과 |
|---|---|
| typecheck · lint | 통과 |
| 단위(vitest unit) | **35파일 517건 통과**(2단계 끝 331 → 새 단위: 이슈·댓글 검증, list-query, safe-url, 마크다운 렌더, 보드 열, 행 순서, 권한 정책 자동 열거·정적 검사) |
| 단위+통합 `--sequence.shuffle` | **50파일 674건 통과**(통합 15파일 157건: issue-service·comment-service·issue-query-service·task-list-service·task-reorder·db-permissions 0005 추가) |
| E2E 전체(Chromium, onesch_e2e) | **44건 통과**(3.9분, 기존 32 + 3단계 12) |
| 새 스펙 `--repeat-each=3` | `project-tabs`+`board` 24건 통과(2.9분), `issues` 12건 통과(2.1분) |
| build(`npm run build`) | 통과(E2E webServer 에서 실행). `/projects/[key]/board`·`list`·`issues`, `/issues` 동적 렌더 |
| 운영 의존성 `npm audit --omit=dev` | 취약점 0건(npm 11.6.2) |

### 3.1 E2E 시나리오 대응

| 시나리오 | 스펙 |
|---|---|
| 탭 이동·aria-current·사이드바 활성·404 | `project-tabs.spec.ts` |
| 목록 필터·검색·정렬 URL 유지(새로고침), 지연 표시 | `project-tabs.spec.ts` |
| 행 순서 마우스·키보드 → DB·감사, 다른 상위 거부(POST 0), 간트 새로고침 반영 | `project-tabs.spec.ts` |
| 보관 프로젝트 목록·보드·이슈 읽기 전용(POST 0·DB 불변) | `project-tabs.spec.ts` |
| 이슈 CRUD·`?issue=` 새로고침 유지·감사 | `issues.spec.ts` |
| 마크다운 XSS(대화상자 0·`window.__xss` 없음·CSP 위반 0·외부 요청 0·rel/target) | `issues.spec.ts` |
| 댓글 권한(VIEWER 작성·본인 수정·삭제, 남의 댓글 단추 없음, ADMIN 삭제) | `issues.spec.ts` |
| `/issues` 필터·KEY-번호 검색·보관 숨김 | `issues.spec.ts` |
| 보드 마우스·키보드 이동 DB·감사, 상위 포함 토글, 카드 열기 | `board.spec.ts` |
| 보드 충돌(되돌림·메시지·최신 값, DB·감사 불변) | `board.spec.ts` |
| 이슈 보드 이동·상세 패널 | `board.spec.ts` |
| VIEWER 보드·목록·이슈(POST 0, 단추 없음) | `board.spec.ts` |

## 4. 계획과 달라진 점

| 항목 | 계획 | 실제 | 이유 |
|---|---|---|---|
| Prisma enum `Same<>` 검사 위치 | `lib/issue/status.ts` | `server/services/issue-dto.ts` | 2단계 `schedule-dto.ts` 와 같은 패턴. 클라이언트 공용 파일에 `@prisma/client` 타입 import 를 두지 않으려고 |
| 작업 목록 계산 | 서비스에서 필터·정렬·페이지 | `task-list-service` 는 `loadTimeline({projectId})` 로 읽고 계산은 순수 함수 `lib/task-list.ts`(메모리) | 계층 순서·상위 경로·지연 판정을 간트와 같게 하고, 작업 대화상자(상위 후보·의존 검사)에 같은 데이터가 필요. 프로젝트 하나는 수백 건 규모 |
| 이슈 검색의 LIKE 이스케이프 | `%_\` 이스케이프 | `escapeLike` 직접 적용 | Prisma `contains` 가 이스케이프하지 않음을 통합 테스트로 확인 |
| 보드 낙관 이동 | 열 이동 순수 함수 | 목록 상태를 바꾸고 `taskColumns/issueColumns` 로 다시 그룹 | 같은 결과에 코드가 적다(처음 만든 `moveCard` 는 쓰이지 않아 지움) |
| 행 순서의 기준 행 | 놓은 행(형제)만 | 놓은 행이 형제의 하위면 그 형제를 기준으로(`siblingAnchor`) | 형제 사이에 하위 행이 끼어 있어 키보드로 한 칸 옮기면 하위 행 위에 놓인다(E2E 에서 발견). 다른 상위 아래는 여전히 거부 |
| 이슈 상세 패널 | — | 모달이 아니라 목록 오른쪽 패널(서버 렌더, 닫기는 링크) | URL query 만으로 열고 닫아 새로고침·공유·서버 마크다운 렌더가 단순 |
| `/issues` 새 이슈의 연결 작업 | — | `/issues` 에서 새로 만들 때는 연결 작업 칸 없음(프로젝트 탭·상세 수정에서는 있음) | 모든 프로젝트 작업 목록을 내려보내지 않으려고 |
| vitest 설정 | — | `oxc.jsx.runtime=automatic` 추가 | 마크다운 컴포넌트(.tsx)를 단위 테스트에서 렌더 |
| `package-lock.json` | — | npm 11.6.2(`npx npm@11.6.2`)로 갱신, 최상위 `@emnapi/core`·`@emnapi/runtime`(dev·optional, wasm 전용) 항목이 빠짐 | 컨테이너 npm 10 은 기존 lock 의 `libc` 필드를 지워 diff 가 커짐. npm 11 로 형식 유지. emnapi 는 wasm32 대체 바인딩에만 쓰여 x86_64·arm64 에 영향 없음 |

## 5. 남은 작업·범위 밖

- 4단계: 대시보드(열린 이슈·마감 임박), 감사 로그 화면.
- 목록 페이지 경계를 넘는 순서 이동(지금은 한 페이지 안에서만 끌 수 있다).
- 보드 열 안의 수동 순서(지금은 종료일·마감일 고정 순서, D20).
- 이슈 알림·멘션, 첨부 파일·이미지(CSP 와 함께 결정).

## 6. 수용한 위험

- **댓글 수정은 마지막 저장이 이긴다**(version 없음). 작성자 한 사람만 고칠 수 있어 충돌 위험이 작다.
- **다른 사용자의 변경은 새로고침 전까지 보이지 않는다**(2단계와 같음). 보드·목록은 저장 뒤 `router.refresh()` 로 다시 읽는다.
- **작업 목록은 프로젝트 작업 전체를 읽는다.** 수천 건 단일 프로젝트가 되면 DB 쪽 계산으로 바꾼다.
- **비활성 담당자 이름은 목록·보드에서 빈칸**(D8·L-5 와 같음). 이슈 목록·상세는 관계로 이름을 읽어 보인다.
- **dnd-kit 의 라이브 영역·끄는 중 transform 은 인라인 style** — `style-src 'unsafe-inline'` 은 1단계부터 유지 중이라 새 완화 없음.
- **`/issues` 의 이슈 상세는 범위 제한 없이 KEY 로 연다**(보관 프로젝트 이슈도 읽기 전용으로 열림). VIEWER 이상이 모든 프로젝트를 읽을 수 있으므로 권한 문제는 아니다.

## 7. 확인이 필요한 것

- 운영 배포 시 `0005_issue_checks` 적용 전, 기존 Issue·Comment 행이 CHECK 를 어기지 않는지(2단계까지 이슈 쓰기 경로가 없어 행이 없을 것).

## 8. 리뷰

(리더가 채운다)

## 9. 실행 방법 메모

NAS 호스트에서는 Prisma 가 segfault 하므로 1·2단계와 같이 `mcr.microsoft.com/playwright:v1.65.1-noble` 컨테이너(`--network host`, `node_modules` 는 볼륨 `one-sch-test-nm`, Node 22 는 볼륨 `one-sch-test-node22`)에서 실행했다. 의존성 설치는 같은 컨테이너에서 `npx npm@11.6.2 install --save-exact …`(4절 참고).
