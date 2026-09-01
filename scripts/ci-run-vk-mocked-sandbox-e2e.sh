#!/usr/bin/env bash
set -euo pipefail

RUN_DIR="${VK_MOCKED_SANDBOX_RUN_DIR:-.vk-mocked-sandbox/current}"
SANDBOX_LOG="$RUN_DIR/ci-sandbox.log"
READY_TIMEOUT_SECONDS="${VK_MOCKED_SANDBOX_READY_TIMEOUT_SECONDS:-1200}"

if [[ -n "${VK_MOCKED_SANDBOX_URL:-}" && -z "${VK_MOCKED_CADDY_PORT:-}" ]]; then
  export VK_MOCKED_CADDY_PORT
  VK_MOCKED_CADDY_PORT="$(node -e "console.log(new URL(process.env.VK_MOCKED_SANDBOX_URL).port || '80')")"
fi

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

# Reuse the free ports selected during setup instead of forcing fixed defaults.
# shellcheck disable=SC1090
source "$RUN_DIR/env.sh"
SANDBOX_URL="${VK_MOCKED_SANDBOX_URL:-${VK_MOCKED_VD_URL:-http://localhost:${VK_MOCKED_CADDY_PORT}}}"
export VK_MOCKED_SANDBOX_URL="$SANDBOX_URL"

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
