#!/bin/bash
set -euo pipefail

SEED_DIR="/opt/vibe-kanban-vscode-web-seed"
REPO_DIR="/home/vkuser/repos/vibe-kanban-vscode-web"

if [ ! -d "$SEED_DIR" ]; then
  echo "Warning: $SEED_DIR not found, skipping repo initialization"
  exit 0
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Initializing vibe-kanban-vscode-web repository from build context"
  mkdir -p "$REPO_DIR"
  if getent group vkadmin > /dev/null 2>&1; then
    chown vkuser:vkadmin "$REPO_DIR" 2>/dev/null || true
  else
    chown vkuser "$REPO_DIR" 2>/dev/null || true
  fi
  chmod g+rwXs "$REPO_DIR" 2>/dev/null || true
  if command -v runuser >/dev/null 2>&1 && id vkuser >/dev/null 2>&1; then
    runuser -u vkuser -- cp -R --no-preserve=ownership "$SEED_DIR"/. "$REPO_DIR"/
  else
    cp -R --no-preserve=ownership "$SEED_DIR"/. "$REPO_DIR"/
  fi
else
  echo "Preserving existing vibe-kanban-vscode-web repository (including .git and data)"
fi
