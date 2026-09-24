#!/usr/bin/env bash
set -euo pipefail

RUN_DIR="${VK_MOCKED_SANDBOX_RUN_DIR:-.vk-mocked-sandbox/current}"
SANDBOX_LOG="$RUN_DIR/ci-sandbox.log"
READY_TIMEOUT_SECONDS="${VK_MOCKED_SANDBOX_READY_TIMEOUT_SECONDS:-1200}"

eval "$(
  node --experimental-strip-types --input-type=module <<'NODE'
import { allocatePorts } from './scripts/vk-mocked-sandbox.ts';

const ports = await allocatePorts(process.env);
const env = {
  VK_MOCKED_BACKEND_PORT: ports.vkBackend,
  VK_MOCKED_FRONTEND_PORT: ports.vkFrontend,
  VK_MOCKED_PREVIEW_PROXY_PORT: ports.vkPreviewProxy,
  VK_MOCKED_VD_DASHBOARD_PORT: ports.vdDashboard,
  VK_MOCKED_VD_SERVER_PORT: ports.vdServer,
  VK_MOCKED_CADDY_PORT: ports.vdCaddy,
};

for (const [key, value] of Object.entries(env)) {
  console.log(`export ${key}=${JSON.stringify(String(value))}`);
}
NODE
)"
SANDBOX_URL="${VK_MOCKED_SANDBOX_URL:-http://localhost:${VK_MOCKED_CADDY_PORT}}"

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
VK_MOCKED_EXTERNAL_SERVER=1 VK_MOCKED_SANDBOX_URL="$SANDBOX_URL" \
  npx playwright test --config playwright.vk-mocked-sandbox.config.ts
