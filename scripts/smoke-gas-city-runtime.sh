#!/usr/bin/env bash
set -euo pipefail

expected_gc="${GASCITY_VERSION:-${VD_GAS_CITY_VERSION:-v1.4.1}}"
expected_beads="${BEADS_VERSION:-${VD_BEADS_VERSION:-v1.2.2}}"
check_bridge=true

for arg in "$@"; do
  case "$arg" in
    --skip-bridge) check_bridge=false ;;
    *) echo "Unknown smoke option" >&2; exit 2 ;;
  esac
done

expected_gc="${expected_gc#v}"
expected_beads="${expected_beads#v}"

gc_json="$(gc version --json)"
printf '%s\n' "$gc_json" | grep -F "${expected_gc}" >/dev/null

bd_version="$(bd version)"
printf '%s\n' "$bd_version" | grep -F "${expected_beads}" >/dev/null
command -v beads >/dev/null

if [[ "$check_bridge" == "true" ]]; then
  command -v gc-session-vibe >/dev/null
  GC_EXEC_STATE_DIR="${GC_EXEC_STATE_DIR:-/tmp/gc-session-vibe-smoke}" gc-session-vibe list-running >/dev/null
fi

printf 'Gas City runtime smoke passed: gc %s, beads %s\n' "$expected_gc" "$expected_beads"
