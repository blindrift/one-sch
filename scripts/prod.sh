#!/bin/sh
# NAS 운영 compose 를 .env.prod 로 실행한다. 사용 예:
#   scripts/prod.sh ps | logs -f app | up -d | restart app
#   scripts/prod.sh build   # NAS 에서 app·migrate 이미지 재빌드(buildx 없는 DSM Docker 용) 후 up -d
# up 에 --wait 를 붙이지 말 것: backup 컨테이너 헬스체크 주기가 1시간이라 끝나지 않는다.
set -eu
cd "$(dirname "$0")/.."
[ -f .env.prod ] || { echo ".env.prod 가 없습니다" >&2; exit 1; }

if [ "${1:-}" = build ]; then
  v=$(git rev-parse --short HEAD)
  for t in runner migrate; do
    n=$([ "$t" = runner ] && echo one-sch-app || echo one-sch-migrate)
    DOCKER_BUILDKIT=0 docker build --target "$t" -t "$n:$v" -t "$n:latest" .
  done
  set -- up -d
fi

exec docker compose --env-file .env.prod -p one-sch "$@"
