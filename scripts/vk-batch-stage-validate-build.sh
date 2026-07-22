#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
VD_REPO=$(cd "$SCRIPT_DIR/.." && pwd)
DEFAULT_VK_REPO=$(cd "$VD_REPO/.." && pwd)/Vktest-batch-stage

VK_BATCH_REPO=${VK_BATCH_REPO:-$DEFAULT_VK_REPO}
VK_BATCH_TARGET_DIR=${VK_BATCH_TARGET_DIR:-${VK_BATCH_REPO}-target}
VK_BATCH_LOG=${VK_BATCH_LOG:-/tmp/vk-batch-stage-validate-build-$(date -u +%Y%m%dT%H%M%SZ).log}
VK_BATCH_SQLITE=${VK_BATCH_SQLITE:-/tmp/vk-batch-stage-sqlx-$(date -u +%Y%m%dT%H%M%SZ).sqlite}
VK_BATCH_ACCEPT_REMOTE_PRIVATE_LIMITATION=${VK_BATCH_ACCEPT_REMOTE_PRIVATE_LIMITATION:-1}

exec > >(tee -a "$VK_BATCH_LOG") 2>&1

export PATH=/usr/local/cargo/bin:/home/vkuser/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games
export CARGO_TARGET_DIR="$VK_BATCH_TARGET_DIR"
export VK_SHARED_API_BASE="${VK_SHARED_API_BASE:-https://api.vibekanban.com}"
export VITE_VK_SHARED_API_BASE="${VITE_VK_SHARED_API_BASE:-$VK_SHARED_API_BASE}"

cd "$VK_BATCH_REPO"

run() {
  echo
  echo "[batch-stage] >>> $*"
  "$@"
}

ensure_clean() {
  local label="$1"
  local status
  status=$(git status --short)
  if [ -n "$status" ]; then
    echo "[batch-stage] ERROR: worktree dirty at ${label}"
    git status --short --branch
    exit 20
  fi
}

validate_local_web_dist() {
  local dist="packages/local-web/dist"
  local index="$dist/index.html"

  if [ ! -s "$index" ]; then
    echo "[batch-stage] ERROR: missing local-web dist index: $index"
    exit 30
  fi

  if grep -q 'Please build @vibe/local-web first' "$index"; then
    echo "[batch-stage] ERROR: local-web dist contains placeholder index"
    exit 31
  fi

  if ! find "$dist/assets" -maxdepth 1 -type f -name 'index-*.js' | grep -q .; then
    echo "[batch-stage] ERROR: local-web dist is missing built index asset"
    exit 32
  fi

  local size_kib
  size_kib=$(du -sk "$dist" | awk '{print $1}')
  if [ "$size_kib" -lt 1024 ]; then
    echo "[batch-stage] ERROR: local-web dist is suspiciously small: ${size_kib}KiB"
    exit 33
  fi
}

validate_server_artifact() {
  local artifact="$1"
  if strings "$artifact" | grep -q 'Please build @vibe/local-web first'; then
    echo "[batch-stage] ERROR: server artifact embeds local-web placeholder"
    exit 40
  fi
}

cleanup() {
  rm -f "$VK_BATCH_SQLITE" "$VK_BATCH_REPO/crates/db/prepare_db.sqlite"
}
trap cleanup EXIT

echo "[batch-stage] starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[batch-stage] log: $VK_BATCH_LOG"
echo "[batch-stage] repo: $VK_BATCH_REPO"
echo "[batch-stage] cargo target dir: $CARGO_TARGET_DIR"
run git status --short --branch
run git rev-parse HEAD
run git log --oneline -5
ensure_clean "start"

echo
echo "[batch-stage] building @vibe/local-web before any Cargo command"
run rm -rf packages/local-web/dist
run pnpm --filter @vibe/local-web run build
validate_local_web_dist
ensure_clean "after local-web build"

rm -f "$VK_BATCH_SQLITE"
mkdir -p "$CARGO_TARGET_DIR"
: > "$VK_BATCH_SQLITE"
export DATABASE_URL="sqlite:$VK_BATCH_SQLITE"
echo "[batch-stage] DATABASE_URL=$DATABASE_URL"
run bash -lc 'cd crates/db && cargo sqlx migrate run'
ensure_clean "after migrations"

run cargo test -p services conversation_preview
ensure_clean "after cargo test -p services conversation_preview"

run cargo test --workspace
ensure_clean "after cargo test --workspace"

run pnpm run generate-types:check
ensure_clean "after pnpm run generate-types:check"

run pnpm --filter @vibe/web-core run check
ensure_clean "after web-core check"

set +e
run pnpm run check
PNPM_CHECK_STATUS=$?
set -e
if [ "$PNPM_CHECK_STATUS" -ne 0 ]; then
  if [ "$VK_BATCH_ACCEPT_REMOTE_PRIVATE_LIMITATION" = "1" ] &&
    grep -q 'BloopAI/vibe-kanban-private' "$VK_BATCH_LOG" &&
    grep -q 'crates/remote' "$VK_BATCH_LOG"; then
    echo "[batch-stage] ACCEPTED_LIMITATION: pnpm run check failed on known private crates/remote dependency fetch pattern; continuing because cargo test --workspace passed."
  else
    echo "[batch-stage] ERROR: pnpm run check failed with non-accepted status $PNPM_CHECK_STATUS"
    exit "$PNPM_CHECK_STATUS"
  fi
fi
ensure_clean "after pnpm run check"

run git diff --check HEAD^ HEAD
ensure_clean "after git diff --check"
run git status --short --branch

SOURCE_COMMIT=$(git rev-parse HEAD)
echo "[batch-stage] building VK server artifact from $SOURCE_COMMIT"
validate_local_web_dist
run cargo clean -p server
run cargo build --release -p server --bin server
ARTIFACT="$CARGO_TARGET_DIR/release/server"
run test -f "$ARTIFACT"
run test -x "$ARTIFACT"
validate_server_artifact "$ARTIFACT"
run ls -lh "$ARTIFACT"
run sha256sum "$ARTIFACT"
ensure_clean "after release build"

echo "[batch-stage] source commit: $SOURCE_COMMIT"
echo "[batch-stage] artifact path: $ARTIFACT"
echo "[batch-stage] build log: $VK_BATCH_LOG"
echo "[batch-stage] completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
