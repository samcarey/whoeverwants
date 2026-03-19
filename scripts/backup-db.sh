#!/bin/bash
# Automated PostgreSQL backup script for the WhoeverWants droplet.
#
# Creates compressed pg_dump backups and rotates old ones.
# Designed to run as a daily cron job.
#
# Usage (cron):
#   0 3 * * * /root/whoeverwants/scripts/backup-db.sh >> /var/log/whoeverwants-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="/var/backups/whoeverwants"
DB_CONTAINER="whoeverwants-db-1"
DB_USER="whoeverwants"
DB_NAME="whoeverwants"
RETENTION_DAYS=14
DATE=$(date +%Y-%m-%d_%H%M)

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting database backup..."

# Create compressed backup via Docker exec
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" \
  | gzip > "$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz"

BACKUP_SIZE=$(du -h "$BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz" | cut -f1)
echo "[$(date -Iseconds)] Backup created: ${DB_NAME}_${DATE}.sql.gz ($BACKUP_SIZE)"

# Rotate old backups
DELETED=$(find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date -Iseconds)] Rotated $DELETED backup(s) older than $RETENTION_DAYS days"
fi

# Show remaining backups
TOTAL=$(find "$BACKUP_DIR" -name "*.sql.gz" | wc -l)
echo "[$(date -Iseconds)] Backup complete. $TOTAL backup(s) on disk."
