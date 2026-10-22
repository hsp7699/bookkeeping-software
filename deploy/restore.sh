#!/usr/bin/env bash
# Restore a backup made by backup.sh. Replaces the current database and attachments.
# Usage: ./restore.sh /var/backups/books/books-20261022T021500Z.dump [/var/backups/books/storage-20261022T021500Z.tgz]
set -euo pipefail
cd "$(dirname "$0")"
DUMP=${1:?pass the .dump file}
STORAGE=${2:-}
read -r -p "This replaces ALL data in the running database. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || exit 1
docker compose stop app
docker compose exec -T db dropdb -U books --if-exists books
docker compose exec -T db createdb -U books books
docker compose exec -T db pg_restore -U books -d books --no-owner < "$DUMP"
if [ -n "$STORAGE" ]; then
  docker compose run --rm --no-deps -v "$(cd "$(dirname "$STORAGE")" && pwd):/backup" --entrypoint sh app \
    -c "rm -rf /data/storage/* && tar -xzf /backup/$(basename "$STORAGE") -C /data"
fi
docker compose start app
echo "Restored from $DUMP"
