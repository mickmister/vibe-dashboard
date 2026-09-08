#!/usr/bin/env bash
set -euo pipefail

MODE=${1:-dry-run}
if [ "$MODE" != "dry-run" ] && [ "$MODE" != "apply" ] && [ "$MODE" != "status" ]; then
  echo "Usage: $0 [dry-run|apply|status] [--confirm-non-dry-run]" >&2
  exit 2
fi

CONFIRMED=0
for arg in "${@:2}"; do
  case "$arg" in
    --confirm-non-dry-run)
      CONFIRMED=1
      ;;
    *)
      echo "Unexpected argument: $arg" >&2
      exit 2
      ;;
  esac
done

VK_RUNTIME_BINARY=${VK_RUNTIME_BINARY:-/usr/local/bin/vibe-kanban}
VK_VERSION_MARKER=${VK_VERSION_MARKER:-/usr/local/share/vibe-kanban-build-version}
VK_HOTSWAP_STATE_DIR=${VK_HOTSWAP_STATE_DIR:-/var/lib/vd/hotswap/vk}
VK_ROLLBACK_BINARY=${VK_ROLLBACK_BINARY:-}
VK_ROLLBACK_VERSION_LABEL=${VK_ROLLBACK_VERSION_LABEL:-}
VK_SUPERVISOR_PROGRAM=${VK_SUPERVISOR_PROGRAM:-vibe-kanban}
VK_API_BASE=${VK_API_BASE:-http://127.0.0.1:3007}
VK_ROLLBACK_LOG=${VK_ROLLBACK_LOG:-/tmp/vk-batch-stage-rollback-$(date -u +%Y%m%dT%H%M%SZ).log}

exec > >(tee -a "$VK_ROLLBACK_LOG") 2>&1

fail() {
  echo "[vk-rollback] ERROR: $*" >&2
  exit 1
}

latest_rollback_binary() {
  find "$VK_HOTSWAP_STATE_DIR" -maxdepth 1 -type f -name 'rollback-*-vibe-kanban' -printf '%T@ %p\n' |
    sort -nr |
    awk 'NR == 1 {print $2}'
}

resolve_rollback_binary() {
  if [ -n "$VK_ROLLBACK_BINARY" ]; then
    printf '%s\n' "$VK_ROLLBACK_BINARY"
    return
  fi
  latest_rollback_binary
}

print_status() {
  echo "[vk-rollback] log: $VK_ROLLBACK_LOG"
  echo "[vk-rollback] runtime binary: $VK_RUNTIME_BINARY"
  echo "[vk-rollback] version marker: $VK_VERSION_MARKER"
  echo "[vk-rollback] state dir: $VK_HOTSWAP_STATE_DIR"
  echo
  echo "[vk-rollback] current runtime:"
  if [ -f "$VK_RUNTIME_BINARY" ]; then
    ls -lh "$VK_RUNTIME_BINARY"
    sha256sum "$VK_RUNTIME_BINARY"
  else
    echo "missing"
  fi
  echo
  echo "[vk-rollback] current version marker:"
  cat "$VK_VERSION_MARKER" 2>/dev/null || true
  echo
  echo
  echo "[vk-rollback] available rollback binaries:"
  find "$VK_HOTSWAP_STATE_DIR" -maxdepth 1 -type f -name 'rollback-*-vibe-kanban' -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' |
    sort || true
}

validate_binary() {
  local binary="$1"
  [ -x "$binary" ] || fail "rollback binary is missing or not executable: $binary"
  if strings "$binary" | grep -q 'Please build @vibe/local-web first'; then
    fail "rollback binary embeds the local-web placeholder: $binary"
  fi
}

install_binary_atomically() {
  local source="$1"
  local target="$2"
  local next="${target}.rollback-next-$$"

  rm -f "$next"
  cp "$source" "$next"
  chmod 0755 "$next"
  test -x "$next"
  mv "$next" "$target"
}

validate_runtime() {
  echo "[vk-rollback] supervisor status"
  supervisorctl status "$VK_SUPERVISOR_PROGRAM" || true

  echo "[vk-rollback] /api/health"
  curl -fsS "$VK_API_BASE/api/health"
  echo

  echo "[vk-rollback] /"
  local root_html
  root_html=$(curl -fsS "$VK_API_BASE/")
  if printf '%s' "$root_html" | grep -q 'Please build @vibe/local-web first'; then
    fail "runtime root route still serves local-web placeholder"
  fi
  printf '%s\n' "$root_html" | sed -n '1,20p'

  echo "[vk-rollback] /api/info"
  curl -fsS "$VK_API_BASE/api/info"
  echo
}

ROLLBACK_BINARY=$(resolve_rollback_binary)

echo "[vk-rollback] starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
print_status
echo
echo "[vk-rollback] selected rollback binary: ${ROLLBACK_BINARY:-none}"

if [ "$MODE" = "status" ]; then
  exit 0
fi

[ -n "$ROLLBACK_BINARY" ] || fail "no rollback binary found in $VK_HOTSWAP_STATE_DIR"
validate_binary "$ROLLBACK_BINARY"

echo "[vk-rollback] selected rollback sha:"
sha256sum "$ROLLBACK_BINARY"

if [ "$MODE" = "dry-run" ]; then
  echo "[vk-rollback] dry-run only. Re-run with apply --confirm-non-dry-run to restore this binary."
  exit 0
fi

if [ "$CONFIRMED" != "1" ]; then
  fail "apply mode requires --confirm-non-dry-run"
fi
if [ -z "$VK_ROLLBACK_VERSION_LABEL" ]; then
  fail "apply mode requires VK_ROLLBACK_VERSION_LABEL so the runtime marker matches the restored binary"
fi

echo "[vk-rollback] installing rollback binary atomically"
install_binary_atomically "$ROLLBACK_BINARY" "$VK_RUNTIME_BINARY"

printf '%s\n' "$VK_ROLLBACK_VERSION_LABEL" > "$VK_VERSION_MARKER"

echo "[vk-rollback] restarting $VK_SUPERVISOR_PROGRAM"
supervisorctl restart "$VK_SUPERVISOR_PROGRAM"

validate_runtime

echo "[vk-rollback] runtime binary sha after rollback"
sha256sum "$VK_RUNTIME_BINARY"
echo "[vk-rollback] version marker after rollback"
cat "$VK_VERSION_MARKER" 2>/dev/null || true
echo
echo "[vk-rollback] completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
