#!/usr/bin/env bash
set -euo pipefail

SANDBOX_URL="${VK_MOCKED_SANDBOX_URL:-http://localhost:50005}"
RUN_DIR="${VK_MOCKED_SANDBOX_RUN_DIR:-.vk-mocked-sandbox/current}"
SANDBOX_LOG="$RUN_DIR/ci-sandbox.log"
READY_TIMEOUT_SECONDS="${VK_MOCKED_SANDBOX_READY_TIMEOUT_SECONDS:-1200}"

export VK_MOCKED_BACKEND_PORT="${VK_MOCKED_BACKEND_PORT:-50000}"
export VK_MOCKED_FRONTEND_PORT="${VK_MOCKED_FRONTEND_PORT:-50001}"
export VK_MOCKED_PREVIEW_PROXY_PORT="${VK_MOCKED_PREVIEW_PROXY_PORT:-50002}"
export VK_MOCKED_VD_DASHBOARD_PORT="${VK_MOCKED_VD_DASHBOARD_PORT:-50003}"
export VK_MOCKED_VD_SERVER_PORT="${VK_MOCKED_VD_SERVER_PORT:-50004}"
export VK_MOCKED_CADDY_PORT="${VK_MOCKED_CADDY_PORT:-50005}"

cleanup() {
  if [[ -n "${sandbox_pid:-}" ]] && kill -0 "$sandbox_pid" 2>/dev/null; then
    kill -TERM "-$sandbox_pid" 2>/dev/null || kill -TERM "$sandbox_pid" 2>/dev/null || true
    wait "$sandbox_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "$RUN_DIR"

npm run e2e:vk-mocked-sandbox:reset -- --variant basic-seeded

echo "::group::Prepare VK mocked sandbox"
VK_MOCKED_PREBUILD_BACKEND=1 node --experimental-strip-types scripts/vk-mocked-sandbox.ts setup
echo "::endgroup::"

echo "Starting VK mocked sandbox; log: $SANDBOX_LOG"
VK_MOCKED_SKIP_SETUP_COMMANDS=1 npm run dev:vk-mocked-sandbox >"$SANDBOX_LOG" 2>&1 &
sandbox_pid=$!

deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
until curl --fail --silent --show-error "$SANDBOX_URL/workspaces" >/dev/null; do
  if ! kill -0 "$sandbox_pid" 2>/dev/null; then
    echo "VK mocked sandbox exited before becoming ready. Last log lines:" >&2
    tail -200 "$SANDBOX_LOG" >&2 || true
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo "Timed out waiting ${READY_TIMEOUT_SECONDS}s for $SANDBOX_URL/workspaces. Last log lines:" >&2
    tail -200 "$SANDBOX_LOG" >&2 || true
    exit 1
  fi
  sleep 2
done

echo "VK mocked sandbox is ready at $SANDBOX_URL/workspaces"
npm run test:e2e:vk-mocked-sandbox
