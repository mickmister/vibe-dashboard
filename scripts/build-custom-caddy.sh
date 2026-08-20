#!/usr/bin/env bash
set -euo pipefail

module_dir="${1:-caddy-module}"
output_path="${2:-./caddy}"
caddy_version="${CADDY_VERSION:-v2.10.2}"
module_import="${CADDY_MODULE_IMPORT:-github.com/yourusername/vibe-kanban-plugins}"

if ! command -v go >/dev/null 2>&1; then
  echo "go is required to build custom Caddy" >&2
  exit 1
fi

if ! command -v xcaddy >/dev/null 2>&1; then
  echo "xcaddy not found; installing with go install" >&2
  GOBIN="${GOBIN:-$(go env GOPATH)/bin}" CGO_ENABLED=0 go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
  export PATH="${GOBIN:-$(go env GOPATH)/bin}:$PATH"
fi

mkdir -p "$(dirname "$output_path")"
module_dir="$(cd "$module_dir" && pwd)"
output_path="$(cd "$(dirname "$output_path")" && pwd)/$(basename "$output_path")"

run_with_retries() {
  local max_attempts="${1:?max attempts required}"
  shift

  local attempt=1
  while true; do
    if "$@"; then
      return 0
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "command failed after ${attempt} attempts: $*" >&2
      return 1
    fi

    echo "command failed on attempt ${attempt}/${max_attempts}; retrying in $((attempt * 5))s: $*" >&2
    sleep "$((attempt * 5))"
    attempt=$((attempt + 1))
  done
}

cd "$module_dir"
run_with_retries 3 env CGO_ENABLED=0 xcaddy build "$caddy_version" \
  --output "$output_path" \
  --with "$module_import=."
chmod +x "$output_path"
"$output_path" list-modules | grep -q 'http.handlers.vibe_kanban_rewriter'
