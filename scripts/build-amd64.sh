#!/usr/bin/env bash
# NAS(linux/amd64)용 app·migrate 이미지를 빌드하고 검사한 뒤 tar 하나로 저장한다.
# 사용: scripts/build-amd64.sh [버전]   (기본: git 짧은 해시)
# 개발 PC(arm64)는 colima --vm-type vz --vz-rosetta 처럼 amd64 를 돌릴 수 있는 환경이 필요하다.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="${1:-$(git rev-parse --short HEAD)}"
OUT="dist/one-sch-${VERSION}-amd64.tar.gz"

if [ -n "$(git status --porcelain)" ]; then
  echo "경고: 커밋하지 않은 변경이 있습니다. 이미지에 그대로 들어갑니다." >&2
fi

for target in runner migrate; do
  name=$([ "$target" = runner ] && echo one-sch-app || echo one-sch-migrate)
  docker buildx build --platform linux/amd64 --target "$target" \
    -t "${name}:${VERSION}" -t "${name}:latest" --load .
done

# 네이티브 바이너리가 standalone 에 들어갔고 실제로 로드되는지 확인(Prisma 엔진·argon2 모두 musl)
docker run --rm --platform linux/amd64 --entrypoint sh "one-sch-app:${VERSION}" \
  -c 'ls node_modules/.prisma/client/ | grep -q musl' || { echo "Prisma musl 엔진이 없습니다" >&2; exit 1; }
docker run --rm --platform linux/amd64 --entrypoint node "one-sch-app:${VERSION}" \
  -e "require('@node-rs/argon2').hash('x').then(h=>{if(!h.startsWith('\$argon2'))process.exit(1)})" \
  || { echo "@node-rs/argon2 linux-x64-musl 바이너리를 불러오지 못했습니다" >&2; exit 1; }

if command -v trivy >/dev/null 2>&1; then
  for name in one-sch-app one-sch-migrate; do
    trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed "${name}:${VERSION}"
  done
else
  echo "경고: trivy 가 없어 이미지 취약점 검사를 건너뜁니다." >&2
fi

mkdir -p dist
docker save "one-sch-app:${VERSION}" "one-sch-app:latest" "one-sch-migrate:${VERSION}" "one-sch-migrate:latest" | gzip > "$OUT"
echo "저장: $OUT"
