#!/usr/bin/env bash
set -euo pipefail

# Docker-only Playwright workflow E2E harness.
#
# Official workflow E2E must execute inside a containerized qa-mode sandbox, not
# directly against the host checkout. This harness mounts VD/VK sources
# read-only, copies them into container-local writable directories, installs
# dependencies in the container, starts the same-origin mocked sandbox from
# inside Docker, and runs Playwright via docker exec.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vd_repo_dir="$(cd "${script_dir}/.." && pwd)"
vk_repo_dir="${VK_REPO_DIR:-$(cd "${vd_repo_dir}/../vibe-kanban" && pwd)}"
image="${WORKFLOW_E2E_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.58.2-noble}"
container_name="${WORKFLOW_E2E_CONTAINER_NAME:-vd-workflow-e2e-playwright-$$}"
host_port="${WORKFLOW_E2E_HOST_PORT:-50005}"
keep_container="${WORKFLOW_E2E_KEEP_CONTAINER:-0}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for workflow Playwright E2E" >&2
  exit 1
fi

if [[ ! -f "${vd_repo_dir}/package.json" ]]; then
  echo "VD repo does not look like vibe-kanban-vscode-web: ${vd_repo_dir}" >&2
  exit 1
fi

if [[ ! -f "${vk_repo_dir}/Cargo.toml" ]]; then
  echo "VK_REPO_DIR does not look like a vibe-kanban checkout: ${vk_repo_dir}" >&2
  exit 1
fi

cleanup() {
  if [[ "${keep_container}" == "1" ]]; then
    echo "Leaving workflow E2E container running for debugging: ${container_name}" >&2
    return
  fi
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting workflow Playwright E2E container: ${container_name} (${image})"
docker run \
  --detach \
  --name "${container_name}" \
  --publish "127.0.0.1:${host_port}:50005" \
  --volume "${vd_repo_dir}:/mnt/source/vibe-kanban-vscode-web:ro" \
  --volume "${vk_repo_dir}:/mnt/source/vibe-kanban:ro" \
  --workdir /workspace/vibe-kanban-vscode-web \
  "${image}" \
  sleep infinity >/dev/null

echo "Preparing and running workflow Playwright E2E inside Docker via docker exec"
docker exec \
  --env CI="${CI:-1}" \
  --env VK_CHECKOUT=/workspace/vibe-kanban \
  --env VK_MOCKED_SANDBOX_URL=http://127.0.0.1:50005 \
  --env VK_MOCKED_BACKEND_PORT=50000 \
  --env VK_MOCKED_FRONTEND_PORT=50001 \
  --env VK_MOCKED_PREVIEW_PROXY_PORT=50002 \
  --env VK_MOCKED_VD_DASHBOARD_PORT=50003 \
  --env VK_MOCKED_VD_SERVER_PORT=50004 \
  --env VK_MOCKED_CADDY_PORT=50005 \
  --env VK_MOCKED_CADDYFILE=Caddyfile.workflow-e2e \
  "${container_name}" bash -lc '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    if ! command -v cargo >/dev/null 2>&1 || ! command -v caddy >/dev/null 2>&1; then
      apt-get update
      apt-get install -y --no-install-recommends curl ca-certificates build-essential pkg-config libssl-dev sqlite3 git caddy
    fi
    if ! command -v cargo >/dev/null 2>&1; then
      curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
      export PATH="/root/.cargo/bin:${PATH}"
    fi
    corepack enable
    rm -rf /workspace/vibe-kanban-vscode-web /workspace/vibe-kanban
    mkdir -p /workspace/vibe-kanban-vscode-web /workspace/vibe-kanban
    tar -C /mnt/source/vibe-kanban-vscode-web \
      --exclude .git \
      --exclude node_modules \
      --exclude dist \
      --exclude data \
      --exclude .vk-mocked-sandbox \
      -cf - . | tar -C /workspace/vibe-kanban-vscode-web -xf -
    tar -C /mnt/source/vibe-kanban \
      --exclude .git \
      --exclude node_modules \
      --exclude target \
      --exclude dev_assets \
      -cf - . | tar -C /workspace/vibe-kanban -xf -
    cd /workspace/vibe-kanban-vscode-web
    pnpm install --frozen-lockfile
    npm rebuild better-sqlite3
    cd /workspace/vibe-kanban
    pnpm install --frozen-lockfile
    cd /workspace/vibe-kanban-vscode-web
    npx playwright test --config playwright.vk-workflows-docker.config.ts
  '

echo "ok - workflow Docker Playwright E2E"
