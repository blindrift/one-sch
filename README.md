# one-sch

여러 IT 프로젝트의 일정·진행 상황·이슈를 한 화면에서 관리하는 소규모 프로젝트 타임라인 웹서비스. 설계는 [docs/technical-design.md](docs/technical-design.md).

> **경고: 기본 계정 admin/admin — 리버스 프록시로 공개하기 전에 바꾸세요.**
> 사용자가 한 명도 없는 DB 에는 `admin` / `admin` 계정이 만들어집니다. 첫 로그인 때 비밀번호 변경이 강제되지만,
> 바꾸기 전까지는 이 계정으로 누구나 로그인할 수 있습니다. 그래서 **compose 기동 → SSH 터널
> (`ssh -L 3000:127.0.0.1:3000 <nas>`)로 admin 비밀번호 변경·구글 ADMIN 등록 → (권장) `LOCAL_LOGIN_ENABLED=false`
> → 그다음 DSM 리버스 프록시 공개** 순서를 지키세요. 자세한 순서는 [설계서 10.2](docs/technical-design.md).
> 리버스 프록시에는 사용자 지정 머리글 `X-Real-IP: $remote_addr` 가 필요합니다(로그인 IP 제한).

## 개발

Node 22, Docker(개발 DB).

```sh
npm ci
npm run db:up        # 127.0.0.1:5433 PostgreSQL (값은 .env.local)
npm run db:migrate
npm run db:seed      # admin/admin
npm run dev
```

| 명령 | 내용 |
|---|---|
| `npm run lint` / `typecheck` | ESLint / tsc |
| `npm test` | 단위 + 통합(테스트 DB `onesch_test`) |
| `npm run test:e2e` | Playwright(빌드 후 3100 포트) |
| `scripts/build-amd64.sh` | NAS 용 app·migrate 이미지 빌드·검사·tar 저장 |
