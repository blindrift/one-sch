#!/bin/sh
# 덤프 1회. backup 컨테이너(postgres 이미지, uid 70)에서 PG* 환경 변수로 접속한다.
# 같은 날 다시 돌리면 그날 파일을 덮어쓴다. 보관 기간이 지난 파일은 지운다.
set -eu
umask 077

dir=/backups
f="$dir/one-sch-$(date +%Y%m%d).dump"
retention="${BACKUP_RETENTION_DAYS:-7}"

pg_dump -Fc -f "$f.tmp"
mv "$f.tmp" "$f"
echo "backup: $f ($(wc -c < "$f") bytes)"

find "$dir" -name 'one-sch-*.dump' -mtime +"$((retention - 1))" -print -delete
find "$dir" -name 'one-sch-*.dump.tmp' -mmin +60 -delete
