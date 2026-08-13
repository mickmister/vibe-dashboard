#!/usr/bin/env bash
set -euo pipefail

context="${DOCKER_CONTEXT:-$(docker context show 2>/dev/null || true)}"
echo "Docker context: ${context:-unknown}"
docker info --format 'OperatingSystem={{.OperatingSystem}}'
docker info --format 'Runtimes={{json .Runtimes}}'

if ! docker info --format '{{json .Runtimes}}' | grep -q 'sysbox-runc'; then
  echo "sysbox-runc is not registered in the active Docker context" >&2
  exit 1
fi

docker run --rm --runtime=sysbox-runc alpine:3.20 true
echo "sysbox-runc smoke passed"
