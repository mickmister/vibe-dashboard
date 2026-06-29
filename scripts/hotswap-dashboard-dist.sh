#!/bin/bash
set -euo pipefail

RUNTIME_DIR="${VIBE_DASHBOARD_RUNTIME_DIR:-/home/vkuser/.local/share/vibe-dashboard-runtime}"
SUPERVISOR_CONF="${SUPERVISOR_CONF:-/etc/supervisor/conf.d/supervisord.conf}"
PROGRAM_NAME="${VIBE_DASHBOARD_SUPERVISOR_PROGRAM:-vibe-dashboard}"
STATE_DIR="${VIBE_DASHBOARD_HOTSWAP_STATE_DIR:-$RUNTIME_DIR/.hotswap}"
PROD_SNAPSHOT="$STATE_DIR/prod-initial-dist"
DEV_ROLLBACK_SNAPSHOT="$STATE_DIR/dev-rollback-dist"
CURRENT_MARKER="$STATE_DIR/current-kind"
LAST_SOURCE_MARKER="$STATE_DIR/last-source"

usage() {
  cat <<EOF
Usage:
  $0 deploy [worktree]
  $0 rollback-dev
  $0 rollback-prod
  $0 status

Subcommands:
  deploy [worktree]  Deploy [worktree]/dist, defaulting to the current directory.
  rollback-dev       Restore the previous dev-deployed dist.
  rollback-prod      Restore the initially captured production dist.
  status             Show runtime and rollback snapshot state.

Environment overrides:
  VIBE_DASHBOARD_RUNTIME_DIR
  VIBE_DASHBOARD_HOTSWAP_STATE_DIR
  VIBE_DASHBOARD_SUPERVISOR_PROGRAM
  SUPERVISOR_CONF
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

require_dist() {
  local dist_dir="$1"

  [ -d "$dist_dir" ] || die "missing dist directory: $dist_dir"
  [ -f "$dist_dir/index.html" ] || die "missing $dist_dir/index.html"
  [ -f "$dist_dir/manifest.json" ] || die "missing $dist_dir/manifest.json"
  [ -f "$dist_dir/node/node-entry.mjs" ] || die "missing $dist_dir/node/node-entry.mjs"
  [ -f "$dist_dir/node/manifest.json" ] || die "missing $dist_dir/node/manifest.json"
}

copy_dist() {
  local src="$1"
  local dest="$2"

  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  cp -a "$src" "$dest"
}

restart_dashboard() {
  supervisorctl -c "$SUPERVISOR_CONF" restart "$PROGRAM_NAME"
}

capture_prod_snapshot_once() {
  if [ -d "$PROD_SNAPSHOT" ]; then
    return 0
  fi

  echo "Capturing initial production snapshot: $PROD_SNAPSHOT"
  copy_dist "$RUNTIME_DIR/dist" "$PROD_SNAPSHOT"
}

replace_runtime_dist() {
  local source_dist="$1"
  local next_kind="$2"
  local source_label="$3"
  local tmp_dist="$RUNTIME_DIR/.dist-next.$$"
  local old_dist="$RUNTIME_DIR/.dist-old.$$"
  local replaced=false

  require_dist "$source_dist"
  require_dist "$RUNTIME_DIR/dist"

  rm -rf "$tmp_dist" "$old_dist"
  cp -a "$source_dist" "$tmp_dist"
  require_dist "$tmp_dist"

  echo "Replacing $RUNTIME_DIR/dist from $source_dist"
  mv "$RUNTIME_DIR/dist" "$old_dist"
  mv "$tmp_dist" "$RUNTIME_DIR/dist"
  replaced=true

  if restart_dashboard; then
    rm -rf "$old_dist"
    printf '%s\n' "$next_kind" > "$CURRENT_MARKER"
    printf '%s\n' "$source_label" > "$LAST_SOURCE_MARKER"
    echo "Deployed $source_label"
    return 0
  fi

  echo "Restart failed; restoring previous runtime dist" >&2
  if [ "$replaced" = true ]; then
    rm -rf "$RUNTIME_DIR/dist"
    mv "$old_dist" "$RUNTIME_DIR/dist"
    restart_dashboard || true
  fi
  rm -rf "$tmp_dist" "$old_dist"
  return 1
}

deploy() {
  local worktree="${1:-$PWD}"
  local source_dist="$worktree/dist"
  local next_dev_rollback="$STATE_DIR/.dev-rollback-next.$$"

  mkdir -p "$STATE_DIR"
  require_dist "$source_dist"
  require_dist "$RUNTIME_DIR/dist"

  capture_prod_snapshot_once

  rm -rf "$next_dev_rollback"
  if [ -f "$CURRENT_MARKER" ] && [ "$(cat "$CURRENT_MARKER")" = "dev" ]; then
    echo "Staging previous dev snapshot: $next_dev_rollback"
    copy_dist "$RUNTIME_DIR/dist" "$next_dev_rollback"
  fi

  if replace_runtime_dist "$source_dist" "dev" "$worktree"; then
    if [ -d "$next_dev_rollback" ]; then
      rm -rf "$DEV_ROLLBACK_SNAPSHOT"
      mv "$next_dev_rollback" "$DEV_ROLLBACK_SNAPSHOT"
      echo "Updated previous dev snapshot: $DEV_ROLLBACK_SNAPSHOT"
    fi
    return 0
  fi

  rm -rf "$next_dev_rollback"
  return 1
}

rollback_dev() {
  [ -d "$DEV_ROLLBACK_SNAPSHOT" ] || die "no previous dev snapshot exists yet"
  replace_runtime_dist "$DEV_ROLLBACK_SNAPSHOT" "dev" "dev rollback snapshot"
}

rollback_prod() {
  [ -d "$PROD_SNAPSHOT" ] || die "no initial production snapshot exists yet"
  replace_runtime_dist "$PROD_SNAPSHOT" "prod" "production rollback snapshot"
}

status() {
  echo "runtime: $RUNTIME_DIR"
  echo "program: $PROGRAM_NAME"
  echo "supervisor conf: $SUPERVISOR_CONF"
  echo "current kind: $(cat "$CURRENT_MARKER" 2>/dev/null || echo unknown)"
  echo "last source: $(cat "$LAST_SOURCE_MARKER" 2>/dev/null || echo unknown)"

  if [ -d "$PROD_SNAPSHOT" ]; then
    echo "prod rollback: $PROD_SNAPSHOT"
  else
    echo "prod rollback: not captured"
  fi

  if [ -d "$DEV_ROLLBACK_SNAPSHOT" ]; then
    echo "dev rollback: $DEV_ROLLBACK_SNAPSHOT"
  else
    echo "dev rollback: not captured"
  fi

  supervisorctl -c "$SUPERVISOR_CONF" status "$PROGRAM_NAME" || true
}

case "${1:-}" in
  deploy)
    shift
    deploy "$@"
    ;;
  rollback-dev)
    shift
    rollback_dev "$@"
    ;;
  rollback-prod)
    shift
    rollback_prod "$@"
    ;;
  status)
    shift
    status "$@"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
