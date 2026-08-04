#!/usr/bin/env bash
set -euo pipefail

# Docker-only workflow/E2E smoke foundation.
#
# This intentionally runs the deterministic VK QA executor tests inside a
# container via docker exec. Do not replace this with host-side cargo/npm test
# execution for workflow E2E; later VD scanner/scheduler E2E tests should add
# commands to the docker exec block or use a purpose-built compose service.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vd_repo_dir="$(cd "${script_dir}/.." && pwd)"
vk_repo_dir="${VK_REPO_DIR:-$(cd "${vd_repo_dir}/../vibe-kanban" && pwd)}"
image="${WORKFLOW_E2E_RUST_IMAGE:-rust:1.90-bookworm}"
container_name="${WORKFLOW_E2E_CONTAINER_NAME:-vd-workflow-e2e-smoke-$$}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for workflow E2E smoke tests" >&2
  exit 1
fi

if [[ ! -f "${vk_repo_dir}/crates/executors/Cargo.toml" ]]; then
  echo "VK_REPO_DIR does not look like a vibe-kanban checkout: ${vk_repo_dir}" >&2
  exit 1
fi

cleanup() {
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting workflow E2E smoke container: ${container_name} (${image})"
docker run \
  --detach \
  --name "${container_name}" \
  --volume "${vk_repo_dir}:/workspace/vibe-kanban:ro" \
  --workdir /workspace/vibe-kanban \
  "${image}" \
  sleep infinity >/dev/null

echo "Running VK scripted QA executor smoke tests inside Docker via docker exec"
docker exec "${container_name}" bash -lc \
  'export PATH="/usr/local/cargo/bin:${PATH}"; export CARGO_TARGET_DIR=/tmp/vk-target; cargo test --locked -p executors --features qa-mode qa_mock --no-default-features'

echo "ok - workflow E2E Docker smoke"
