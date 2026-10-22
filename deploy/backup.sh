#!/usr/bin/env bash
# Nightly backup: database dump + attachments, kept 30 days locally, optionally copied off-site.
# Cron (as root):  15 2 * * *  /opt/books/deploy/backup.sh >> /var/log/books-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=${BACKUP_DIR:-/var/backups/books}
mkdir -p "$DEST"

docker compose exec -T db pg_dump -U books -d books --format=custom --no-owner > "$DEST/books-$STAMP.dump"
docker compose run --rm --no-deps -v "$DEST:/backup" --entrypoint sh app -c "tar -czf /backup/storage-$STAMP.tgz -C /data storage"

# sanity check: the dump must list the ledger table
docker compose exec -T db pg_restore --list < "$DEST/books-$STAMP.dump" | grep -q "TABLE public ledger_entries" || { echo "backup looks wrong" >&2; exit 1; }

find "$DEST" -name 'books-*.dump' -mtime +30 -delete
find "$DEST" -name 'storage-*.tgz' -mtime +30 -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy "$DEST" "$BACKUP_REMOTE" --include "*-$STAMP.*"
fi
echo "$(date -u) backup ok: $STAMP"
