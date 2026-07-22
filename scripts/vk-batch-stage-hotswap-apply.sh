#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
VD_REPO=$(cd "$SCRIPT_DIR/.." && pwd)
DEFAULT_VK_REPO=$(cd "$VD_REPO/.." && pwd)/Vktest
DEFAULT_ARTIFACT_ROOT=$(cd "$VD_REPO/.." && pwd)/Vktest-batch-stage-target

VK_REPO=${VK_REPO:-$DEFAULT_VK_REPO}
VK_ARTIFACT=${VK_ARTIFACT:-$DEFAULT_ARTIFACT_ROOT/release/server}
VK_VERSION_LABEL=${VK_VERSION_LABEL:-}
VK_HOTSWAP_ID=${VK_HOTSWAP_ID:-vk-batch-stage-$(date -u +%Y%m%dT%H%M%SZ)}
VK_HOTSWAP_LOG=${VK_HOTSWAP_LOG:-/tmp/vk-batch-stage-hotswap-$(date -u +%Y%m%dT%H%M%SZ).log}
VK_PLATFORM=${VK_PLATFORM:-linux-x64}
VK_SUPERVISOR_PROGRAM=${VK_SUPERVISOR_PROGRAM:-vibe-kanban}
VK_API_BASE=${VK_API_BASE:-http://127.0.0.1:3007}

exec > >(tee -a "$VK_HOTSWAP_LOG") 2>&1

export PATH=/usr/local/cargo/bin:/home/vkuser/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games

fail() {
  echo "[batch-hotswap] ERROR: $*" >&2
  exit 1
}

require_clean_repo() {
  local repo="$1"
  local label="$2"
  local status
  status=$(git -C "$repo" status --short)
  if [ -n "$status" ]; then
    echo "[batch-hotswap] ERROR: dirty $label repo"
    git -C "$repo" status --short --branch
    exit 20
  fi
}

if [ -z "$VK_VERSION_LABEL" ]; then
  fail "VK_VERSION_LABEL is required, for example weekly-dev-vk-\$(git -C ../Vktest rev-parse --short HEAD)-sha256-<sha8>"
fi

echo "[batch-hotswap] starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[batch-hotswap] log: $VK_HOTSWAP_LOG"
echo "[batch-hotswap] VD: $VD_REPO"
echo "[batch-hotswap] VK: $VK_REPO"
echo "[batch-hotswap] artifact: $VK_ARTIFACT"
echo "[batch-hotswap] version label: $VK_VERSION_LABEL"

require_clean_repo "$VD_REPO" "VD"
require_clean_repo "$VK_REPO" "VK"

[ -x "$VK_ARTIFACT" ] || fail "artifact missing or not executable: $VK_ARTIFACT"
if strings "$VK_ARTIFACT" | grep -q 'Please build @vibe/local-web first'; then
  fail "artifact embeds local-web placeholder; rebuild with scripts/vk-batch-stage-validate-build.sh"
fi
EXPECTED_SHA=$(sha256sum "$VK_ARTIFACT" | awk '{print $1}')
echo "[batch-hotswap] expected artifact sha: $EXPECTED_SHA"

echo "[batch-hotswap] supervisor status before"
supervisorctl status "$VK_SUPERVISOR_PROGRAM" || true

echo "[batch-hotswap] version marker before"
cat /usr/local/share/vibe-kanban-build-version 2>/dev/null || true
echo

echo "[batch-hotswap] VK /api/health before"
curl -fsS "$VK_API_BASE/api/health"
echo

echo "[batch-hotswap] applying VK-only hotswap"
npm run hotswap:vkvd -- apply --confirm-non-dry-run \
  --scope vk-only \
  --vk-source local-prebuilt-binary \
  --allow-local-prebuilt-binary \
  --vk-binary "$VK_ARTIFACT" \
  --vk-version-label "$VK_VERSION_LABEL" \
  --platform "$VK_PLATFORM" \
  --vk-program "$VK_SUPERVISOR_PROGRAM" \
  --id "$VK_HOTSWAP_ID"

echo "[batch-hotswap] supervisor status after"
supervisorctl status "$VK_SUPERVISOR_PROGRAM" || true

echo "[batch-hotswap] VK /api/health after"
curl -fsS "$VK_API_BASE/api/health"
echo

echo "[batch-hotswap] VK / after"
ROOT_HTML=$(curl -fsS "$VK_API_BASE/")
if printf '%s' "$ROOT_HTML" | grep -q 'Please build @vibe/local-web first'; then
  fail "runtime root route still serves local-web placeholder"
fi
printf '%s\n' "$ROOT_HTML" | sed -n '1,20p'

echo "[batch-hotswap] VK /api/info after"
curl -fsS "$VK_API_BASE/api/info"
echo

echo "[batch-hotswap] version marker after"
ACTUAL_VERSION_LABEL=$(cat /usr/local/share/vibe-kanban-build-version 2>/dev/null || true)
printf '%s\n' "$ACTUAL_VERSION_LABEL"
if [ "$ACTUAL_VERSION_LABEL" != "$VK_VERSION_LABEL" ]; then
  fail "version marker mismatch: expected $VK_VERSION_LABEL, got ${ACTUAL_VERSION_LABEL:-<missing>}"
fi
echo

echo "[batch-hotswap] runtime binary sha after"
ACTUAL_SHA=$(sha256sum /usr/local/bin/vibe-kanban | awk '{print $1}')
printf '%s  /usr/local/bin/vibe-kanban\n' "$ACTUAL_SHA"
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  fail "runtime binary SHA mismatch: expected $EXPECTED_SHA, got $ACTUAL_SHA"
fi

echo "[batch-hotswap] completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
