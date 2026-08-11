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
base_image="${WORKFLOW_E2E_PLAYWRIGHT_BASE_IMAGE:-mcr.microsoft.com/playwright:v1.58.2-noble}"
image="${WORKFLOW_E2E_PLAYWRIGHT_IMAGE:-vd-workflow-e2e-playwright:local}"
container_name="${WORKFLOW_E2E_CONTAINER_NAME:-vd-workflow-e2e-playwright-$$}"
host_port="${WORKFLOW_E2E_HOST_PORT:-50005}"
keep_container="${WORKFLOW_E2E_KEEP_CONTAINER:-0}"
cache_key="$(printf "%s" "${vd_repo_dir}" | shasum | awk '{print substr($1,1,12)}')"
log_dir="${WORKFLOW_E2E_LOG_DIR:-${TMPDIR:-/tmp}/vd-workflow-e2e-logs-${container_name}}"
cargo_target_volume="${WORKFLOW_E2E_CARGO_TARGET_VOLUME:-vd-workflow-e2e-vk-target-${cache_key}}"
cargo_registry_volume="${WORKFLOW_E2E_CARGO_REGISTRY_VOLUME:-vd-workflow-e2e-cargo-registry-${cache_key}}"
cargo_git_volume="${WORKFLOW_E2E_CARGO_GIT_VOLUME:-vd-workflow-e2e-cargo-git-${cache_key}}"

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

mkdir -p "${log_dir}"
echo "Workflow E2E logs: ${log_dir}"

if [[ -z "${WORKFLOW_E2E_PLAYWRIGHT_IMAGE:-}" ]]; then
  echo "Building workflow E2E Docker image: ${image} (base ${base_image})"
  docker build \
    --build-arg "PLAYWRIGHT_IMAGE=${base_image}" \
    --file "${vd_repo_dir}/scripts/Dockerfile.workflow-e2e" \
    --tag "${image}" \
    "${vd_repo_dir}"
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
  --volume "${log_dir}:/tmp/workflow-e2e-logs" \
  --volume "${cargo_target_volume}:/tmp/vk-target" \
  --volume "${cargo_registry_volume}:/root/.cargo/registry" \
  --volume "${cargo_git_volume}:/root/.cargo/git" \
  --workdir /workspace/vibe-kanban-vscode-web \
  "${image}" \
  sleep infinity >/dev/null

echo "Preparing and running workflow Playwright E2E inside Docker via docker exec"
docker exec \
  --env CI="${CI:-1}" \
  --env CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}" \
  --env CARGO_INCREMENTAL=0 \
  --env CARGO_PROFILE_DEV_DEBUG=0 \
  --env RUSTFLAGS="${RUSTFLAGS:--C debuginfo=0 -C linker=clang -C link-arg=-fuse-ld=lld}" \
  --env CARGO_TARGET_DIR=/tmp/vk-target \
  --env NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" \
  --env OPENSSL_NO_VENDOR=1 \
  --env PNPM_CONFIG_CHILD_CONCURRENCY="${PNPM_CONFIG_CHILD_CONCURRENCY:-1}" \
  --env PNPM_CONFIG_NETWORK_CONCURRENCY="${PNPM_CONFIG_NETWORK_CONCURRENCY:-4}" \
  --env RUSTUP_TOOLCHAIN=stable \
  --env VK_CHECKOUT=/workspace/vibe-kanban \
  --env VK_MOCKED_SANDBOX_URL=http://127.0.0.1:50005 \
  --env VK_MOCKED_BACKEND_PORT=50000 \
  --env VK_MOCKED_FRONTEND_PORT=50001 \
  --env VK_MOCKED_PREVIEW_PROXY_PORT=50002 \
  --env VK_MOCKED_VD_DASHBOARD_PORT=50003 \
  --env VK_MOCKED_VD_SERVER_PORT=50004 \
  --env VK_MOCKED_CADDY_PORT=50005 \
  --env VK_MOCKED_CADDYFILE=Caddyfile.workflow-e2e \
  --env VK_MOCKED_SKIP_LOCAL_WEB_BUILD=1 \
  "${container_name}" bash -lc '
    set -euo pipefail
    run_with_log() {
      local name="$1"
      shift
      local log="/tmp/workflow-e2e-logs/${name}.log"
      echo "==> ${name}"
      "$@" >"${log}" 2>&1 &
      local pid="$!"
      while kill -0 "${pid}" >/dev/null 2>&1; do
        sleep 10
        if kill -0 "${pid}" >/dev/null 2>&1; then
          echo "==> ${name} still running"
        fi
      done
      if ! wait "${pid}"; then
        echo "Step failed: ${name}; tailing ${log}" >&2
        tail -200 "${log}" >&2 || true
        return 1
      fi
    }

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
    run_with_log vd-pnpm-install pnpm install --frozen-lockfile --child-concurrency=1 --network-concurrency=4
    cd /workspace/vibe-kanban
    run_with_log vk-pnpm-install pnpm install --frozen-lockfile --child-concurrency=1 --network-concurrency=4
    mkdir -p packages/local-web/dist
    printf "%s" "<!doctype html><title>VK mocked local web stub</title>" > packages/local-web/dist/index.html
    find /root/.cargo/git /tmp/vk-target -name "*.lock" -delete 2>/dev/null || true
    run_with_log vk-cargo-build cargo build --features qa-mode --bin server
    cd /workspace/vibe-kanban-vscode-web
    run_with_log playwright npx playwright test --config playwright.vk-workflows-docker.config.ts --output=/tmp/workflow-e2e-logs/playwright-test-results
  '

echo "ok - workflow Docker Playwright E2E"
