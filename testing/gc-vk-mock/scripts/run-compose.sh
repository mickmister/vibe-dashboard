#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
compose_file="$script_dir/../docker-compose.yml"

cleanup() {
  docker compose -f "$compose_file" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -f "$compose_file" up --build --abort-on-container-exit --exit-code-from smoke
