#!/usr/bin/env bash
set -euo pipefail

image="${VKVD_SMOKE_IMAGE:-vk-vd-plugin-runtime-smoke:local}"
container_name="${VKVD_SMOKE_CONTAINER:-vk-vd-plugin-runtime-smoke}"
caddy_port="${VKVD_SMOKE_CADDY_PORT:-33101}"
backend_port="${VKVD_SMOKE_BACKEND_PORT:-33107}"
code_port="${VKVD_SMOKE_CODE_PORT:-33108}"
dashboard_port="${VKVD_SMOKE_DASHBOARD_PORT:-33105}"
beads_host="beads-web.localhost:${caddy_port}"

cleanup() {
  status="$?"
  if [[ "$status" != "0" ]]; then
    docker logs "$container_name" || true
    docker exec "$container_name" supervisorctl status || true
    docker exec "$container_name" sh -lc 'ls -la /etc/supervisor/conf.d/vd-generated /etc/caddy /var/lib/vd/plugins /var/lib/vd/plugin-cache 2>/dev/null || true' || true
    docker exec "$container_name" sh -lc 'cat /etc/caddy/plugins.caddy 2>/dev/null || true' || true
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

if [[ "${VKVD_SMOKE_BUILD_IMAGE:-false}" == "true" ]]; then
  docker build \
    --file Dockerfile.vkvd \
    --build-arg VK_RUNTIME_SOURCE=stub \
    --build-arg VK_COMMIT=ci-plugin-runtime-smoke \
    --tag "$image" \
    .
fi

docker rm -f "$container_name" >/dev/null 2>&1 || true
docker run -d \
  --name "$container_name" \
  --network host \
  -e "CADDY_PORT=${caddy_port}" \
  -e "PROXY_DOMAIN=localhost" \
  -e "BACKEND_PORT=${backend_port}" \
  -e "DASHBOARD_PORT=${dashboard_port}" \
  -e "CODE_PORT=${code_port}" \
  -e "CODE_PASSWORD=__unset__" \
  -e "ENABLE_VIBE_KANBAN=false" \
  -e "VK_SHARED_API_BASE=" \
  -e "VK_ALLOWED_ORIGINS=" \
  -e "ENABLE_TAILSCALE=false" \
  -e "TAILSCALE_AUTHKEY=" \
  -e "TAILSCALE_HOSTNAME=vkdev" \
  -e "MEMORY_WATCHDOG_ENABLED=false" \
  -e "MEMORY_WATCHDOG_MATTERMOST_WEBHOOK_URL=" \
  "$image" >/dev/null

echo "Waiting for generated beads-web plugin supervisor config..."
for attempt in $(seq 1 180); do
  if docker exec "$container_name" test -f /etc/supervisor/conf.d/vd-generated/vd-plugin--vd_beads_web--web.conf; then
    break
  fi
  if [[ "$attempt" == "180" ]]; then
    echo "Timed out waiting for generated beads-web supervisor config" >&2
    exit 1
  fi
  sleep 2
done

echo "Waiting for beads-web plugin supervisor program to run..."
for attempt in $(seq 1 120); do
  if docker exec "$container_name" supervisorctl status vd-plugin--vd_beads_web--web | grep -q RUNNING; then
    break
  fi
  if [[ "$attempt" == "120" ]]; then
    echo "Timed out waiting for beads-web supervisor program to enter RUNNING state" >&2
    docker exec "$container_name" supervisorctl status vd-plugin--vd_beads_web--web || true
    exit 1
  fi
  sleep 2
done
docker exec "$container_name" grep -q 'beads-web.{\$PROXY_DOMAIN}' /etc/caddy/plugins.caddy

echo "Waiting for beads-web through generated Caddy plugin route..."
for attempt in $(seq 1 180); do
  if curl -fsS -H "Host: ${beads_host}" "http://127.0.0.1:${caddy_port}/" -o /tmp/vd-beads-web.html; then
    if grep -qi '<html' /tmp/vd-beads-web.html; then
      echo "beads-web HTML responded through Caddy on attempt ${attempt}"
      break
    fi
  fi
  if [[ "$attempt" == "180" ]]; then
    echo "Timed out waiting for beads-web HTML through Caddy" >&2
    exit 1
  fi
  sleep 2
done

asset_path="$(
  python3 - <<'PY'
import re
from pathlib import Path

html = Path('/tmp/vd-beads-web.html').read_text()
match = re.search(r'src="(/_next/[^"]+\.js[^"]*)"', html)
print(match.group(1) if match else '')
PY
)"
if [[ -z "$asset_path" ]]; then
  echo "No Next.js asset script found in beads-web HTML" >&2
  exit 1
fi

curl -fsS -H "Host: ${beads_host}" "http://127.0.0.1:${caddy_port}${asset_path}" -o /tmp/vd-beads-web-asset.js
test -s /tmp/vd-beads-web-asset.js

curl -fsS -H "Host: ${beads_host}" "http://127.0.0.1:${caddy_port}/api/projects" -o /tmp/vd-beads-web-projects.json
python3 -m json.tool /tmp/vd-beads-web-projects.json >/dev/null

echo "beads-web plugin runtime smoke passed."
