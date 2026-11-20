#!/bin/sh
# 매일 03:00(TZ) 에 backup.sh 를 실행한다. cron 없이 sleep 으로 기다린다.
# 실패해도 루프는 계속 돌고, 오류는 stderr(컨테이너 로그)로 남긴다.
set -u

seconds_until_3am() {
  # date 는 두 자리(앞자리 0)를 주므로 0 을 한 번 떼어 10진수로 계산한다(POSIX sh, busybox ash 호환)
  h=$(date +%H); m=$(date +%M); s=$(date +%S)
  now=$(( ${h#0} * 3600 + ${m#0} * 60 + ${s#0} ))
  target=$(( 3 * 3600 ))
  if [ "$now" -lt "$target" ]; then echo $(( target - now )); else echo $(( 86400 - now + target )); fi
}

while true; do
  wait_s=$(seconds_until_3am)
  echo "backup-loop: next run in ${wait_s}s"
  sleep "$wait_s"
  if ! /bin/sh /scripts/backup.sh; then
    echo "backup-loop: backup failed" >&2
  fi
  # 같은 03:00 에 두 번 돌지 않도록 1분 쉰다
  sleep 60
done
