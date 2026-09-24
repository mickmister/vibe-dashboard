#!/bin/sh
set -eu

# User-facing wrapper for applying plugin catalog/config changes and reloading
# generated plugin runtime state. Keep Supervisor/Caddy implementation details in
# vd-plugin-runtime-apply.sh so operators only need one stable command.
exec /usr/local/bin/vd-plugin-runtime-apply.sh "$@"
