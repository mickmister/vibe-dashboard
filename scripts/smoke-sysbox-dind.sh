#!/usr/bin/env bash
set -euo pipefail

service_name="${VKVD_SMOKE_SERVICE:-code-vibe}"
project_args=()
if [ -n "${VKVD_SMOKE_PROJECT_NAME:-}" ]; then
  project_args=(-p "${VKVD_SMOKE_PROJECT_NAME}")
fi

log() {
  printf '%s\n' "$*"
}

skip() {
  log "SKIP: $*"
  exit 0
}

compose() {
  docker compose "${project_args[@]}" "$@"
}

is_docker_desktop() {
  docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -qi 'Docker Desktop'
}

host_lists_sysbox_runtime() {
  docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q 'sysbox-runc'
}

if ! docker info >/dev/null 2>&1; then
  skip "Docker daemon is unavailable on the host"
fi

if ! host_lists_sysbox_runtime && ! is_docker_desktop; then
  skip "Sysbox runtime not detected on this host; install sysbox-runc or use Docker Desktop Enhanced Container Isolation"
fi

log "Starting ${service_name} for Sysbox Docker-in-Docker smoke..."
if ! compose_output="$(compose up -d "$service_name" 2>&1)"; then
  if printf '%s' "$compose_output" | grep -qiE 'unknown.*runtime|sysbox|enhanced container isolation|oci runtime'; then
    skip "Sysbox runtime not detected or ${service_name} could not start"
  fi
  printf '%s\n' "$compose_output" >&2
  exit 1
fi
printf '%s\n' "$compose_output"

container_name="$(compose ps -q "$service_name")"
if [ -z "$container_name" ]; then
  skip "${service_name} container was not created"
fi

deadline=$((SECONDS + ${VKVD_SMOKE_TIMEOUT_SECONDS:-180}))
while [ "$SECONDS" -lt "$deadline" ]; do
  state="$(docker inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null || true)"
  if [ "$state" = "exited" ] || [ "$state" = "dead" ]; then
    logs="$(docker logs "$container_name" 2>&1 || true)"
    if printf '%s' "$logs" | grep -qiE 'must run with sysbox-runc|Enhanced Container Isolation|Sysbox runtime preflight'; then
      skip "Sysbox runtime not detected by ${service_name} entrypoint"
    fi
    printf '%s\n' "$logs" >&2
    echo "${service_name} exited before Docker became ready" >&2
    exit 1
  fi

  if docker exec "$container_name" sh -lc 'test -S /var/run/docker.sock && docker info >/dev/null 2>&1'; then
    break
  fi
  sleep 2
done

docker exec "$container_name" sh -lc 'test -S /var/run/docker.sock && docker info >/dev/null'
if ! docker exec "$container_name" sh -lc 'docker run --rm hello-world >/tmp/vkvd-hello-world.log 2>&1'; then
  log "hello-world smoke failed; falling back to alpine:3.20 true"
  docker exec "$container_name" sh -lc 'docker run --rm alpine:3.20 true'
fi

log "Sysbox Docker-in-Docker smoke passed for ${service_name}."
