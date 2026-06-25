#!/bin/sh
set -eu

reload_caddy_with_retry() {
  attempts="${VD_PLUGIN_CADDY_RELOAD_ATTEMPTS:-20}"
  delay="${VD_PLUGIN_CADDY_RELOAD_DELAY_SECONDS:-1}"
  attempt=1

  while [ "$attempt" -le "$attempts" ]; do
    if caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
      return 0
    fi

    echo "Caddy reload failed on attempt ${attempt}/${attempts}; retrying in ${delay}s" >&2
    attempt=$((attempt + 1))
    sleep "$delay"
  done

  echo "Caddy reload failed after ${attempts} attempts; generated plugin config remains on disk. Check Caddy logs and rerun vd-plugin-runtime-apply.sh." >&2
  return 1
}

desired_autostart_plugin_programs() {
  config_dir="${VD_PLUGIN_SUPERVISOR_CONFIG_DIR:-/etc/supervisor/conf.d/vd-generated}"

  for config_path in "$config_dir"/*.conf; do
    [ -e "$config_path" ] || continue
    awk '
      /^\[program:vd-plugin--[a-zA-Z0-9_][a-zA-Z0-9_]*--[a-zA-Z0-9_][a-zA-Z0-9_]*\]$/ {
        program = $0
        sub(/^\[program:/, "", program)
        sub(/\]$/, "", program)
        autostart = ""
        next
      }

      /^\[/ {
        if (program != "" && autostart == "true") print program
        program = ""
        autostart = ""
        next
      }

      /^autostart[[:space:]]*=[[:space:]]*true[[:space:]]*$/ {
        if (program != "") autostart = "true"
      }

      END {
        if (program != "" && autostart == "true") print program
      }
    ' "$config_path"
  done
}

reconcile_enabled_plugin_programs() {
  attempts="${VD_PLUGIN_SUPERVISOR_START_ATTEMPTS:-30}"
  delay="${VD_PLUGIN_SUPERVISOR_START_DELAY_SECONDS:-1}"

  desired_autostart_plugin_programs | while IFS= read -r program; do
    [ -n "$program" ] || continue

    status_output="$(supervisorctl status "$program" 2>&1)" || {
      echo "Failed to read supervisor status for enabled plugin program ${program}: ${status_output}" >&2
      return 1
    }
    status="$(printf '%s\n' "$status_output" | awk 'NR == 1 { print $2 }')"
    if [ "$status" = "RUNNING" ]; then
      continue
    fi

    if [ "$status" = "STARTING" ]; then
      echo "Waiting for enabled plugin supervisor program ${program} to reach RUNNING; current status is STARTING." >&2
    else
      echo "Starting enabled plugin supervisor program ${program}; current status is ${status:-unknown}." >&2
      start_output="$(supervisorctl start "$program" 2>&1)" || {
        echo "Failed to start enabled plugin supervisor program ${program}. Previous status: ${status:-unknown}. supervisorctl output: ${start_output}" >&2
        return 1
      }
    fi

    attempt=1
    while [ "$attempt" -le "$attempts" ]; do
      status_output="$(supervisorctl status "$program" 2>&1)" || {
        echo "Failed to verify supervisor status for enabled plugin program ${program} after start: ${status_output}" >&2
        return 1
      }
      status="$(printf '%s\n' "$status_output" | awk 'NR == 1 { print $2 }')"
      if [ "$status" = "RUNNING" ]; then
        break
      fi
      if [ "$attempt" -lt "$attempts" ]; then
        sleep "$delay"
      fi
      attempt=$((attempt + 1))
    done

    if [ "$status" != "RUNNING" ]; then
      echo "Enabled plugin supervisor program ${program} did not reach RUNNING after ${attempts} status checks. Current status: ${status:-unknown}. supervisorctl output: ${status_output}" >&2
      return 1
    fi
  done
}

# Reconcile plugin services after the core supervisor-managed services have
# started. Caddy starts with /etc/caddy/plugins.caddy present, and this runtime
# apply updates that plugin-owned file plus generated supervisor programs when
# artifacts become available.

VD_PLUGIN_ORCHESTRATOR_INSTALL_ARTIFACTS=true \
  node /opt/vibe-kanban-vscode-web-seed/dist/plugins-orchestrator/plugin-service-orchestrator-cli.js apply \
    --catalog /opt/vibe-kanban-vscode-web-seed/plugins/builtin.plugins.json \
    --optional-catalog /var/lib/vd/instance-config/plugins.json \
    --artifact-cache-root /var/lib/vd/plugin-cache \
    --install-root /var/lib/vd/plugins \
    --plugin-bin-dir /var/lib/vd/plugin-bin \
    --toolchain-root /var/lib/vd/toolchains \
    --supervisor-config-dir /etc/supervisor/conf.d/vd-generated \
    --caddy-plugin-config-path /etc/caddy/plugins.caddy \
    --caddy-config-path /etc/caddy/Caddyfile

supervisorctl reread
supervisorctl update
reconcile_enabled_plugin_programs

# Caddy is intentionally kept up during plugin installation. Once plugin-owned
# routes are generated, reload Caddy in-place so new plugin subdomains activate
# without restarting the container.
reload_caddy_with_retry
