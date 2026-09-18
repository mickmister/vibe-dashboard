#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cache_root="${XDG_CACHE_HOME:-${HOME:?HOME must be set}/.cache}"
output_path="${1:-$cache_root/vibe-dashboard/preview-caddy/slot-repo-workspace-customer-v1/caddy}"

if command -v go >/dev/null 2>&1; then
  exec "$repo_root/scripts/build-custom-caddy.sh" "$repo_root/caddy-module" "$output_path"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Go or Docker is required to build the current Preview URL Caddy binary" >&2
  exit 1
fi

mkdir -p "$(dirname "$output_path")"
container_id="$(docker create -w /workspace golang:1.25.5 \
  bash -c 'export PATH=/usr/local/go/bin:$PATH; ./build-custom-caddy.sh caddy-module /tmp/custom-caddy')"
cleanup() { docker rm -f "$container_id" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker cp "$repo_root/caddy-module" "$container_id:/workspace/caddy-module"
docker cp "$repo_root/scripts/build-custom-caddy.sh" "$container_id:/workspace/build-custom-caddy.sh"
docker start -a "$container_id"
docker cp "$container_id:/tmp/custom-caddy" "$output_path"
chmod +x "$output_path"
echo "Built current Preview URL Caddy: $output_path"
