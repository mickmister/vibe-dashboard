#!/usr/bin/env bash
set -euo pipefail

profile="${COLIMA_SYSBOX_PROFILE:-vd-sysbox}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_src="${script_dir}/colima-sysbox.yaml"
config_dir="${HOME}/.colima/${profile}"
config_dst="${config_dir}/colima.yaml"

log() {
  printf '%s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd colima
require_cmd docker

mkdir -p "$config_dir"
cp "$config_src" "$config_dst"

log "Starting Colima profile '${profile}' from ${config_dst}..."
colima start "$profile"

context="colima-${profile}"
log "Switching Docker context to ${context}..."
docker context use "$context" >/dev/null

log "Installing/registering Sysbox inside Colima profile '${profile}'..."
colima ssh --profile "$profile" -- sudo bash -s < "${script_dir}/install-sysbox-guest.sh"

log "Verifying sysbox-runc is registered..."
if ! docker info --format '{{json .Runtimes}}' | grep -q 'sysbox-runc'; then
  cat >&2 <<EOF2
Sysbox runtime was not detected after starting Colima profile '${profile}'.
Inspect provisioning logs with:
  colima ssh --profile ${profile} -- journalctl -u docker --no-pager --lines=200
  colima ssh --profile ${profile} -- docker info
EOF2
  exit 1
fi

log "Checking sysbox-runc can launch a container..."
docker run --rm --runtime=sysbox-runc alpine:3.20 true

log "Colima Sysbox profile '${profile}' is ready."
log "Use it with: DOCKER_CONTEXT=${context} docker compose up -d code-vibe"
