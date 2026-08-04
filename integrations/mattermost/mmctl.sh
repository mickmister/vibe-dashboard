#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${MATTERMOST_SERVICE_NAME:-mattermost}"

exec_args=(exec)
if [[ ! -t 0 || ! -t 1 || "${MMCTL_NO_TTY:-}" == "1" ]]; then
  exec_args+=(-T)
fi

cd "$SCRIPT_DIR"
exec docker compose "${exec_args[@]}" "$SERVICE_NAME" /mattermost/bin/mmctl "$@"
