#!/bin/bash
set -e

DB_DIR="/home/vkuser/.local/share/vibe-kanban"
DB_BASENAME="db.v2.sqlite"
DB_FILE="$DB_DIR/$DB_BASENAME"
VERSION_FILE="$DB_DIR/.last-vk-version"

# Ensure DB directory exists (in case this runs before vibe-kanban creates it)
mkdir -p "$DB_DIR"

# Get the version that will be installed/run
NEXT_VERSION=$(npm view vibe-kanban@${VIBE_KANBAN_VERSION:-latest} version 2>/dev/null)

if [ -z "$NEXT_VERSION" ]; then
    echo "Warning: Could not determine vibe-kanban version from npm registry"
    exit 0
fi

# Get the last run version
LAST_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || echo "none")

echo "Last run version: $LAST_VERSION"
echo "Next run version: $NEXT_VERSION"

# If versions differ and database exists, back it up
if [ "$NEXT_VERSION" != "$LAST_VERSION" ] && [ -f "$DB_FILE" ]; then
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    BACKUP_FILE="$DB_DIR/$DB_BASENAME.backup-$TIMESTAMP-v$LAST_VERSION"

    cp "$DB_FILE" "$BACKUP_FILE"
    echo "✓ Created backup: $(basename "$BACKUP_FILE")"
    echo "  Upgrading from v$LAST_VERSION to v$NEXT_VERSION"

    # Cleanup old backups (keep last 5)
    OLD_BACKUPS=$(ls -t "$DB_DIR"/"$DB_BASENAME".backup-* 2>/dev/null | tail -n +6)
    if [ -n "$OLD_BACKUPS" ]; then
        echo "$OLD_BACKUPS" | xargs rm -f
        echo "✓ Cleaned up old backups (kept 5 most recent)"
    fi
elif [ "$NEXT_VERSION" != "$LAST_VERSION" ] && [ ! -f "$DB_FILE" ]; then
    echo "ℹ First run with v$NEXT_VERSION (no database to backup)"
elif [ "$NEXT_VERSION" = "$LAST_VERSION" ]; then
    echo "✓ Same version (v$NEXT_VERSION), no backup needed"
fi

# Save current version for next run
echo "$NEXT_VERSION" > "$VERSION_FILE"
echo "✓ Saved version marker: v$NEXT_VERSION"
