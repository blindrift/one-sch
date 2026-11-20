#!/bin/sh
# 골격: 덤프를 "새" 데이터베이스에 복원한다. 기존 onesch DB 는 건드리지 않는다.
# 사용: scripts/restore.sh backups/one-sch-YYYYMMDD.dump
# 이후 전환(앱 중지 → DB 이름 교체 → 앱 시작)은 docs/deploy-synology.md(5단계)에서 절차로 정리한다.
set -eu

dump="${1:-}"
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "사용: $0 <덤프 파일>" >&2
  exit 2
fi

target="onesch_restore_$(date +%Y%m%d%H%M%S)"
compose="docker compose"

echo "1) 덤프 목록 확인"
$compose exec -T db pg_restore -l < "$dump" > /dev/null

echo "2) 새 DB 생성: $target (소유자 onesch_owner)"
$compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d onesch -v db="$target" <<'SQL'
CREATE DATABASE :"db" OWNER onesch_owner;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO onesch_app, onesch_backup;
SQL

echo "3) 복원(권한·소유자 포함, 오류 시 중단)"
$compose exec -T db pg_restore -U postgres -d "$target" --exit-on-error < "$dump"

echo "4) 확인"
$compose exec -T db psql -U postgres -d "$target" -c 'SELECT count(*) AS users FROM "User";' \
  -c 'SELECT count(*) AS audit_logs FROM "AuditLog";' \
  -c 'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1;'

cat <<EOF

복원 완료: $target
전환 예(앱 중지 후):
  docker compose stop app
  docker compose exec -T db psql -U postgres -c 'ALTER DATABASE onesch RENAME TO onesch_old_$(date +%Y%m%d);'
  docker compose exec -T db psql -U postgres -c 'ALTER DATABASE $target RENAME TO onesch;'
  docker compose start app
확인 뒤 onesch_old_* 는 직접 지운다.
EOF
