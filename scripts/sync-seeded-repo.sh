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
  cp -a "$SEED_DIR"/. "$REPO_DIR"/
else
  echo "Preserving existing vibe-kanban-vscode-web repository (including .git and data)"
fi
