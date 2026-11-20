#!/bin/sh
# postgres 공식 이미지가 데이터 디렉터리가 비어 있는 첫 기동 때만 실행한다.
# 역할: onesch_owner(마이그레이션·시드, DDL), onesch_app(DML 만), onesch_backup(읽기 전용).
# 개발용(compose.dev.yml)만 EXTRA_DATABASES(테스트 DB)와 OWNER_CREATEDB(migrate dev 의 shadow DB)를 쓴다.
# 기본 권한(DML)은 이후 onesch_owner 가 만드는 모든 표에 붙으므로 _prisma_migrations 에도 붙는다 →
# 0001_init 마이그레이션이 그 권한을 회수한다.
# 실행 비트가 빠지면 엔트리포인트가 이 파일을 source 하므로 셸 옵션은 -e 만 쓴다(-u 는 엔트리포인트 변수까지 검사해 깨뜨릴 수 있음).
set -e

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD 가 필요합니다}"
: "${MIGRATOR_DB_PASSWORD:?MIGRATOR_DB_PASSWORD 가 필요합니다}"
: "${BACKUP_DB_PASSWORD:?BACKUP_DB_PASSWORD 가 필요합니다}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$MIGRATOR_DB_PASSWORD" -v app_pw="$APP_DB_PASSWORD" -v backup_pw="$BACKUP_DB_PASSWORD" <<'SQL'
CREATE ROLE onesch_owner  LOGIN PASSWORD :'owner_pw';
CREATE ROLE onesch_app    LOGIN PASSWORD :'app_pw';
CREATE ROLE onesch_backup LOGIN PASSWORD :'backup_pw';
GRANT pg_read_all_data TO onesch_backup;
SQL

if [ "${OWNER_CREATEDB:-false}" = "true" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c 'ALTER ROLE onesch_owner CREATEDB;'
fi

setup_db() {
  db="$1"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO onesch_owner;
GRANT USAGE ON SCHEMA public TO onesch_app, onesch_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE onesch_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO onesch_app;
ALTER DEFAULT PRIVILEGES FOR ROLE onesch_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO onesch_app;
SQL
  # psql 변수 치환은 -c 에서는 동작하지 않으므로 stdin 으로 보낸다.
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v db="$db" <<'SQL'
ALTER DATABASE :"db" OWNER TO onesch_owner;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO onesch_app, onesch_backup;
SQL
}

setup_db "$POSTGRES_DB"

for extra in ${EXTRA_DATABASES:-}; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v db="$extra" <<'SQL'
CREATE DATABASE :"db";
SQL
  setup_db "$extra"
done
