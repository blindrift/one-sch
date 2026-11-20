# 1단계(기반) 결과 보고

| 항목 | 내용 |
|---|---|
| 브랜치 | `feat/phase1-foundation` |
| 작성일 | 2026-11-20 |
| 판정 | **통과 보류** — 코드·단위·운영 compose 검증 완료, 마이그레이션(개발 DB)·통합·E2E 미실행 |

## 1. 현재 상태

- 구현: 설계서 12절 1단계 전체 — Next.js 골격, Prisma 스키마(설계서 5절 전 모델), 구글 SSO(허용 목록)·로컬 admin 로그인, 세션, 권한 가드, 보안 헤더·CSP, `/admin/users`, 감사 로그, Docker/compose, 백업 스크립트, 간트 PoC(`docs/gantt-poc.md`).
- 리뷰: 보안·로직·테스트 리뷰어 3명, 수정·재검토 3회. 최종적으로 Critical·High 결함 0.
- 확인된 것: 단위 테스트 159건(무작위 순서 포함) 통과, lint·typecheck·build 통과, 운영 의존성 `npm audit` 0건. 권한 검사 회귀 테스트는 우회 코드 29종을 넣어 모두 실패하는 것을 확인. 운영 compose 검증(아래 1.2)도 통과.
- **아직 실행하지 못한 것**: 개발 DB 마이그레이션과 통합 테스트(약 50건), E2E(14건). `.env.local` 의 `MIGRATE_DATABASE_URL` 인증 실패로 막혀 있다(1.2 참고).

### 1.1 진행 내역

| 일시(2026-11-20) | 내용 |
|---|---|
| 오전 | 기술 설계서 작성(`docs/technical-design.md`), 단계별 브랜치·로컬 환경 결정 |
| 오후 | analyst 분석 → 사용자 결정(초기 admin/admin, 로컬 계정 admin 하나, 심각도 없음) → developer 15단계 구현(15커밋) |
| 오후 | 리뷰 1차(SEC M3·L6 / LOG M1·L9 / TST H2·M7·L7) → 수정 F1–F27(11커밋). 사용자 결정: SEC-1 은 문서만, 접속자 IP 는 X-Real-IP |
| 오후 | 재검토 1차: 신규 High 1(route 가드 fail-open) → 수정 G1–G11(8커밋, `withApi` 도입) |
| 오후 | 재검토 2차: 신규 High 1(정적 검사가 `data`·`out` 폴더를 건너뜀) → 수정 H1–H10(4커밋) |
| 오후 | 재검토 3차: 신규 결함 없음. 남은 위험 정리 → 이 보고서 작성 |
| 저녁 | Docker(colima)·Node 22 설치, `.env.local` 작성(구글 제외). 검증 1·2·6·7단계 진행, trivy HIGH 10건 수정(`e288f61`) |

### 1.2 검증 결과 (2.2 절 순서 기준)

| 단계 | 결과 |
|---|---|
| 1. Node 22 `npm ci` | 통과. 단위 159·lint·typecheck·audit 0 |
| 2. 개발 DB `db:up`(빈 볼륨) | 통과. 역할 3개, `onesch`·`onesch_test`·`onesch_e2e`, timezone Asia/Seoul |
| 3. 마이그레이션 | **막힘** — Prisma P1000 `onesch_owner` 인증 실패. DB 쪽 비밀번호는 정상(컨테이너에서 세 계정 로그인 성공)이고 `.env.local` 의 `MIGRATE_DATABASE_URL` 비밀번호 부분이 다르다. 원인 후보: URL 에 `${VAR}` 참조(`process.loadEnvFile` 은 치환하지 않음), 자리표시자 그대로, 또는 셸에 같은 이름 변수가 이미 있음(덮어쓰지 않음) |
| 4. 통합 테스트 | 미실행(3단계 대기) |
| 5. E2E | 미실행(3단계 대기) |
| 6. 운영 compose 리허설 | **통과** — amd64 빌드, Prisma musl·argon2 로드, db read_only+cap_add 첫 초기화 성공(R6 해소), 4개 컨테이너 ReadonlyRootfs·CapDrop ALL·no-new-privileges, db 포트 미노출, app healthy·`/api/health` 200, DB 권한(AuditLog 앱 SELECT·INSERT 만, `_prisma_migrations` 앱 권한 없음, 트리거 2개, owner TRUNCATE·DELETE 거부, 앱 CREATE TABLE 거부), 백업·`pg_restore -l`(함수·트리거·ACL 포함), db 외부 통신 차단, 보안 헤더 |
| 6. trivy | 처음 HIGH 10건(베이스 이미지의 npm CLI 의존성) → 실행 이미지에서 npm·corepack 제거로 0건(`e288f61`) |
| 7. SSH 터널 흉내(https `AUTH_URL` + `http://localhost`) | Chromium 성공(로그인→비밀번호 변경→`/admin/users`), **WebKit(Safari) 실패**(`upgrade-insecure-requests` 로 정적 파일을 https 로 요청). 결정: CSP 완화 없이 문서에 Chrome 필수 명시(설계서 10.2) |

참고: brew 의 compose 플러그인을 docker 가 찾도록 `~/.docker/config.json` 에 `cliPluginsExtraDirs` 를 추가했다(저장소 밖 설정).

다음 할 일: `.env.local` URL 5개를 실제 비밀번호로 고친 뒤 3→4→5 단계를 진행하고, 결과에 따라 판정한다.

## 2. 통과 판정을 위한 남은 작업

### 2.1 환경 준비
```
brew install colima docker docker-buildx docker-compose fnm
fnm install 22
colima start --vm-type vz --vz-rosetta --cpu 4 --memory 6
```

`.env.local` (git 제외, 값은 직접 생성):

| 키 | 값 |
|---|---|
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `MIGRATOR_DB_PASSWORD`, `BACKUP_DB_PASSWORD` | 각각 `openssl rand -hex 24` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` | `http://localhost:3000` |
| `LOCAL_LOGIN_ENABLED` | `true` |
| `DATABASE_URL` | `postgresql://onesch_app:<APP_DB_PASSWORD>@127.0.0.1:5433/onesch?schema=public` |
| `MIGRATE_DATABASE_URL` | `postgresql://onesch_owner:<MIGRATOR_DB_PASSWORD>@127.0.0.1:5433/onesch?schema=public` |
| `TEST_DATABASE_URL` | `postgresql://onesch_app:<APP_DB_PASSWORD>@127.0.0.1:5433/onesch_test?schema=public` |
| `TEST_MIGRATE_DATABASE_URL` | `postgresql://onesch_owner:<MIGRATOR_DB_PASSWORD>@127.0.0.1:5433/onesch_test?schema=public` |
| `TEST_ADMIN_DATABASE_URL` | `postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5433/onesch_test?schema=public` (테스트 DB 정리 전용. E2E 는 DB 이름을 `onesch_e2e` 로 바꿔 씀) |
| `CLIENT_IP_HEADER` | 선택, 기본 `x-real-ip` |

URL 의 `<…>` 자리에는 **실제 비밀번호 값**을 넣는다. `${APP_DB_PASSWORD}` 같은 변수 참조는 docker compose 는 치환하지만 마이그레이션 스크립트(`process.loadEnvFile`)는 치환하지 않아 인증이 실패한다. 셸에 같은 이름의 변수가 export 돼 있으면 `.env.local` 값이 무시된다.

`.env.example` 에는 위 키 중 운영용(`AUTH_*`, `LOCAL_LOGIN_ENABLED`, `ENABLE_POC`, `TZ`, DB 비밀번호 4종, `APP_VERSION`, `CLIENT_IP_HEADER`)을 값 없이 둔다. 구글 OAuth 값은 비워도 앱이 뜬다.

### 2.2 검증 순서
1. `fnm use 22 && npm ci`
2. `npm run db:up` — **빈 볼륨**에서 시작해야 역할·`onesch_test`·`onesch_e2e` 가 생성된다.
3. 마이그레이션 적용 → `prisma migrate diff` 무차이 → psql 로 `\dp "AuditLog"`, `\dp _prisma_migrations` 확인.
4. 통합 테스트를 파일별로: health → db-permissions → seed → session → login → user-service. 그다음 `npm test` 전체와 `--sequence.shuffle`. ADMIN 3명 동시 강등 테스트는 10회 이상 반복.
   - 특히 볼 것: 잠금 시각 시간대(`login.test` 'DB 시간대'), advisory lock 의 `$queryRaw`, AuditLog TRUNCATE 트리거와 superuser 리셋.
5. `npm run test:e2e` (통합 테스트와 동시에 돌리지 말 것).
6. `scripts/build-amd64.sh` → `docker compose up`: app healthy, db 포트 미노출, ReadonlyRootfs·CapDrop 적용, db 컨테이너가 read_only+cap 설정으로 첫 초기화되는지, argon2·Prisma musl 바이너리 로드, 백업 수동 실행 후 `pg_restore -l`, trivy HIGH/CRITICAL 0.
7. SSH 터널(`ssh -L 3000:127.0.0.1:3000 <nas>`) + https `AUTH_URL` 상태에서 Chrome 으로 admin 첫 비밀번호 변경이 되는지(Safari 는 불가 — 1.2 참고).

배포 시 추가: DSM 리버스 프록시에 `X-Real-IP $remote_addr` 사용자 지정 머리글 설정, 위조 헤더 실측(설계서 10.2), 로그인 상태에서 구글 재로그인.

## 3. 설계서와 달라진 구현 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 로컬 로그인 | Auth.js Credentials 대신 자체 Server Action, 세션 테이블은 공유 | Credentials 는 database 세션에서도 JWT 쿠키를 써서 서버에서 폐기 불가 |
| 마이그레이션 | 별도 일회성 `migrate` 컨테이너(owner 계정) | 앱 계정은 DML 만, 운영 이미지에 Prisma CLI 불필요 |
| 강제 비밀번호 변경 | middleware 가 아니라 `requireRole`/`requirePage` 에서 차단 | Edge middleware 는 DB 를 볼 수 없음 |
| API route | `export const GET = withApi('ROLE', handler)` 형태만 허용, 정책 표(`tests/unit/authz/route-policy.ts`)와 일치 강제 | 권한 검사 결과를 버리는 코드가 구조적으로 불가능하게 |
| 클라이언트 IP | `CLIENT_IP_HEADER`(기본 X-Real-IP) 단일 헤더만 신뢰 | X-Forwarded-For 는 위조 가능 |
| 계정 잠금 | 검증 전에 실패 횟수를 원자적으로 예약, 잠금은 조건부 UPDATE 로 실제 잠갔을 때만 감사 | 동시 요청으로 5회 초과 추측 방지, DB 연결 점유 최소화 |
| 추가 모델·컬럼 | `LoginAttempt`, `User.username`(email nullable), `Session.createdAt`, `Project.issueSeq`, 세션 토큰 SHA-256 해시 저장 | rate limit, 로컬 admin, 절대 7일 만료, 이슈 번호, 토큰 유출 대비 |
| 감사 로그 | 앱 계정 UPDATE·DELETE·TRUNCATE 회수 + 행·문장 트리거 | append-only 이중 방어 |
| 사용자 결정 | 초기 비밀번호 항상 admin/admin, 로컬 계정은 admin 하나, 이슈 심각도 없음(우선순위로 대체) | 2026-11-20 확정 |

## 4. 수용한 위험

- **초기 admin/admin**: 배포 순서(프록시 공개 전 SSH 터널로 비밀번호 변경)로만 막는다. 사용자가 0명이 되면 다시 생긴다. 이 절차는 Chrome 계열에서만 동작한다(Safari 불가, CSP 는 완화하지 않음).
- **admin 잠금 공격**: 아이디가 알려져 있어 누구나 15분마다 잠글 수 있다. 구글 ADMIN 등록 후 `LOCAL_LOGIN_ENABLED=false` 로 해소.
- **DB 연결 풀(5개) 고갈 시** 모든 로컬 로그인이 RATE_LIMITED. 앱 로그의 `*.busy` 반복을 모니터링 신호로.
- `style-src 'unsafe-inline'` (간트 라이브러리·Next style 속성).
- 로그인 성공이 동시 요청의 잠금을 해제할 수 있음, 비밀번호 해시 예외 시 실패 카운트 1 잔존 — 실영향 낮음.

## 5. 2단계로 넘길 항목

- 새 route 추가 시 `withApi` + 정책 표 등록, 대상 ID 의 존재·소속(IDOR) 확인은 서비스 계층에서.
- 정적 권한 검사의 남은 빈틈(Low): 최상위 즉시 실행 async 함수·class static 블록, 공개 page(login·루트)의 import 그래프 미검사, page 역할 정책 표 없음, 저장소 최상위 `data/`·`out/` 의 'use server'.
- 간트: SVAR 종료일은 배타적이므로 `@db.Date` 와 ±1일 변환, react-core CSS 의 외부 `@font-face` 제거(CSP 유지), 열 정의 직접.
- 마크다운 렌더링에서 raw HTML 비허용.
- db 컨테이너 cap_add 축소(첫 init 후 `user: 70:70`), 감사 로그 보관·정리 절차 운영.
- public 에 파일을 추가하면 middleware 공개 경로(`PUBLIC_PREFIXES`)도 갱신.
- 설계서 정리: 7.2 "middleware 가 막는다" → `requireRole`, 1.3 "심각도" 언급 삭제.
