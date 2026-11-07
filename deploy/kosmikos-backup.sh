#!/usr/bin/env bash
# Kosmikos backup: database + uploads. See DEPLOY.md, step 3.
# Install as /usr/local/bin/kosmikos-backup and run daily from cron.
set -euo pipefail
umask 077                                        # backups readable by root only

APP_DIR=${APP_DIR:-/srv/kosmikos}
DEST=${DEST:-/var/backups/kosmikos}              # keep outside the web root
DB_CNF=${DB_CNF:-/etc/kosmikos/backup.cnf}       # [client] user/password for kosmikos_backup
DB_NAME=${DB_NAME:-kosmikos}
KEEP_DAYS=${KEEP_DAYS:-14}

STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DEST"
trap 'rm -f "$DEST"/*_"$STAMP".*.part' EXIT   # remove half-written files on failure

# Database. The sessions table is skipped: it holds login tokens and is
# useless after a restore.
mysqldump --defaults-extra-file="$DB_CNF" \
  --single-transaction --no-tablespaces --ignore-table="$DB_NAME.sessions" \
  "$DB_NAME" | gzip > "$DEST/db_$STAMP.sql.gz.part"
mv "$DEST/db_$STAMP.sql.gz.part" "$DEST/db_$STAMP.sql.gz"

# User uploads (not in git, so this is their only copy).
tar -C "$APP_DIR" -czf "$DEST/uploads_$STAMP.tar.gz.part" uploads
mv "$DEST/uploads_$STAMP.tar.gz.part" "$DEST/uploads_$STAMP.tar.gz"

# Delete old backups (and any leftovers from failed runs).
find "$DEST" -type f \( -name '*.gz' -o -name '*.part' \) -mtime +"$KEEP_DAYS" -delete

echo "Backup written: $DEST/db_$STAMP.sql.gz, $DEST/uploads_$STAMP.tar.gz"
