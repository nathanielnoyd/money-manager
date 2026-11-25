#!/bin/sh
# mm-backup: schedule | now | snapshots | restore [snapshot-id|latest] | check
set -eu
set -o pipefail

: "${DATABASE_HOST:=db}"
: "${DATABASE_NAME:=money_manager}"
: "${BACKUP_TIME:=03:30}"   # daily, in the container's TZ (UTC unless TZ is set)
: "${RESTIC_REPOSITORY:=/backups/restic}"
export RESTIC_REPOSITORY

load() { # read NAME from NAME_FILE when set (Docker secrets)
  eval "file=\${${1}_FILE:-}"
  if [ -n "$file" ]; then export "$1=$(cat "$file")"; fi
}
load PGPASSWORD
load RESTIC_PASSWORD
[ -n "${RESTIC_PASSWORD:-}" ] || { echo "RESTIC_PASSWORD(_FILE) is required" >&2; exit 1; }
# Unset empty provider credentials so restic doesn't try to use them.
for v in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY B2_ACCOUNT_ID B2_ACCOUNT_KEY; do
  eval "[ -n \"\${$v:-}\" ] || unset $v"
done

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

ensure_repo() {
  if ! restic cat config >/dev/null 2>&1; then
    log "initialising restic repository at $RESTIC_REPOSITORY"
    restic init
  fi
}

backup_now() {
  ensure_repo
  log "backup: dumping $DATABASE_NAME"
  pg_dump -h "$DATABASE_HOST" -U mm_admin -d "$DATABASE_NAME" -Fc \
    | restic backup --stdin --stdin-filename "$DATABASE_NAME.dump" --tag mm --quiet
  restic forget --tag mm --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune --quiet
  date -u +%s > /tmp/last-backup
  log "backup: ok"
}

seconds_until() { # HH:MM → seconds until its next occurrence
  now=$(date +%s)
  target=$(date -D "%Y-%m-%d %H:%M" -d "$(date +%Y-%m-%d) $1" +%s)
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo $((target - now))
}

case "${1:-schedule}" in
  now) backup_now ;;
  snapshots) restic snapshots --tag mm ;;
  check) restic check ;;
  restore)
    # Restore into a fresh database, then swap names. The current database is kept
    # (renamed) rather than overwritten, so a bad restore can't destroy anything.
    snap="${2:-latest}"
    stamp=$(date -u +%Y%m%d%H%M%S)
    staging="${DATABASE_NAME}_restore_${stamp}"
    previous="${DATABASE_NAME}_before_restore_${stamp}"
    pg() { psql -h "$DATABASE_HOST" -U mm_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

    log "restore: fetching snapshot $snap"
    restic dump --tag mm "$snap" "$DATABASE_NAME.dump" > /tmp/restore.dump
    log "restore: loading into staging database $staging"
    pg -c "CREATE DATABASE \"$staging\""
    if ! pg_restore -h "$DATABASE_HOST" -U mm_admin -d "$staging" --exit-on-error /tmp/restore.dump; then
      log "restore: FAILED; $DATABASE_NAME was not touched (staging copy left as $staging)"
      exit 1
    fi
    : > /tmp/restore.dump
    log "restore: swapping databases"
    pg -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DATABASE_NAME' AND pid <> pg_backend_pid()" >/dev/null
    pg -c "ALTER DATABASE \"$DATABASE_NAME\" RENAME TO \"$previous\""
    pg -c "ALTER DATABASE \"$staging\" RENAME TO \"$DATABASE_NAME\""
    log "restore: ok. The previous data is kept as database \"$previous\"."
    log "restore: once you've checked the app, remove it with: docker compose exec db dropdb -U mm_admin $previous"
    ;;
  schedule)
    ensure_repo
    while true; do
      wait=$(seconds_until "$BACKUP_TIME")
      log "next backup in $((wait / 3600))h$(((wait % 3600) / 60))m"
      sleep "$wait"
      backup_now || log "backup: FAILED (will retry at the next scheduled time)"
    done
    ;;
  *) echo "usage: mm-backup schedule|now|snapshots|restore [id|latest]|check" >&2; exit 2 ;;
esac
