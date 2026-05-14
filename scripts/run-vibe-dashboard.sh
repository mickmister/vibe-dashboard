#!/bin/bash
set -euo pipefail

REPO_DIR="/home/vkuser/repos/vibe-kanban-vscode-web"
RUNTIME_DIR="/home/vkuser/.local/share/vibe-dashboard-runtime"
RUNTIME_SEED_DIR="/opt/vibe-dashboard-package-seed"
OLD_RUNTIME_DIR="/home/vkuser/repos/.vibe-dashboard-runtime"

if [ ! -d "$RUNTIME_SEED_DIR" ]; then
  echo "Missing packaged vibe-dashboard runtime seed at $RUNTIME_SEED_DIR" >&2
  exit 1
fi

if [ ! -f "$RUNTIME_DIR/dist/node/node-entry.mjs" ]; then
  echo "Initializing packaged vibe-dashboard runtime in $RUNTIME_DIR"
  mkdir -p "$RUNTIME_DIR"
  cp -a "$RUNTIME_SEED_DIR"/. "$RUNTIME_DIR"/
fi

if [ -d "$OLD_RUNTIME_DIR/data" ] && [ ! -e "$RUNTIME_DIR/data" ]; then
  echo "Migrating vibe-dashboard data from $OLD_RUNTIME_DIR/data to $RUNTIME_DIR/data"
  cp -a "$OLD_RUNTIME_DIR/data" "$RUNTIME_DIR/data"
fi

if [ -d "$REPO_DIR/data" ] && [ ! -e "$RUNTIME_DIR/data" ]; then
  echo "Migrating vibe-dashboard data from $REPO_DIR/data to $RUNTIME_DIR/data"
  cp -a "$REPO_DIR/data" "$RUNTIME_DIR/data"
fi

mkdir -p "$RUNTIME_DIR/data"

cd "$RUNTIME_DIR"
exec node dist/node/node-entry.mjs
