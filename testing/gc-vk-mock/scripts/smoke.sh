#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[gc-vk-mock] %s\n' "$*"
}

wait_for_text() {
  local target="$1"
  local expected="$2"
  local attempts="${3:-30}"
  local delay="${4:-2}"
  local output

  for ((i=1; i<=attempts; i++)); do
    output="$(gc session peek "$target" --lines 200 2>/dev/null || true)"
    if [[ "$output" == *"$expected"* ]]; then
      printf '%s' "$output"
      return 0
    fi
    sleep "$delay"
  done

  printf '%s' "$output"
  return 1
}

cleanup() {
  if [[ -n "${CITY_DIR:-}" && -d "$CITY_DIR" ]]; then
    log "session list before cleanup"
    gc session list --json --state all || true
    gc session kill smoke-e2e || true
  fi
}
trap cleanup EXIT

export PATH="/usr/local/go/bin:${PATH}"
export PATH="$(go env GOPATH)/bin:${PATH}"
export PATH="/opt/gc-bin:${PATH}"

log "building gc from ${GC_UPSTREAM_ROOT}"
mkdir -p /opt/gc-bin
cd "$GC_UPSTREAM_ROOT"
go build -o /opt/gc-bin/gc ./cmd/gc
cd "$VD_ROOT"

log "waiting for VK API"
until curl -fsS "${VIBE_BASE_URL}/health" >/dev/null; do
  sleep 2
done

log "registering repo ${VK_REPO_PATH}"
repos_json="$(curl -fsS "${VIBE_BASE_URL}/api/repos")"
repo_id="$(printf '%s' "$repos_json" | jq -r --arg path "$VK_REPO_PATH" '.data[]? | select(.path == $path) | .id' | head -n1)"
if [[ -z "$repo_id" || "$repo_id" == "null" ]]; then
  curl -fsS -X POST "${VIBE_BASE_URL}/api/repos/register" \
    -H 'content-type: application/json' \
    -d "$(jq -nc --arg path "$VK_REPO_PATH" '{path:$path, display_name:"gascity"}')" >/dev/null
  repos_json="$(curl -fsS "${VIBE_BASE_URL}/api/repos")"
  repo_id="$(printf '%s' "$repos_json" | jq -r --arg path "$VK_REPO_PATH" '.data[]? | select(.path == $path) | .id' | head -n1)"
fi
if [[ -z "$repo_id" || "$repo_id" == "null" ]]; then
  log "failed to register gascity repo"
  exit 1
fi
log "registered repo id: ${repo_id}"

CITY_DIR="$(mktemp -d /tmp/gc-vk-mock-city.XXXXXX)"
mkdir -p "$CITY_DIR/packs"
ln -s "$GC_UPSTREAM_ROOT/examples/gastown/packs/gastown" "$CITY_DIR/packs/gastown-upstream"
ln -s "$HARNESS_ROOT/packs/vk-mock" "$CITY_DIR/packs/vk-mock"

cat > "$CITY_DIR/city.toml" <<CITY
[workspace]
name = "gc-vk-mock"
provider = "opencode"

[beads]
provider = "file"

[session]
provider = "exec:${VD_ROOT}/packages/gc-session-vibe/scripts/gc-session-vibe"

[imports.gastown]
source = "packs/gastown-upstream"

[imports.vk_mock]
source = "packs/vk-mock"
CITY

log "creating smoke session"
cd "$CITY_DIR"
gc session new smoke --alias smoke-e2e --title "GC/VK mock smoke" --no-attach

gc session list --json --state all | jq .

log "waiting for initial mock response"
initial_output="$(wait_for_text smoke-e2e GC_VK_MOCK_INITIAL_RESPONSE 45 2)" || {
  printf '%s\n' "$initial_output"
  log "initial response not observed"
  exit 1
}
printf '%s\n' "$initial_output"

log "submitting follow-up"
gc session submit smoke-e2e GC_VK_MOCK_FOLLOW_UP_PROMPT --intent follow_up

log "waiting for follow-up mock response"
follow_output="$(wait_for_text smoke-e2e GC_VK_MOCK_FOLLOW_UP_RESPONSE 45 2)" || {
  printf '%s\n' "$follow_output"
  log "follow-up response not observed"
  exit 1
}
printf '%s\n' "$follow_output"

log "mock integration smoke test passed"
