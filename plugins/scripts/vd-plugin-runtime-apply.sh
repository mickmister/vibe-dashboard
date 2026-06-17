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

# Reconcile plugin services after the core supervisor-managed services have
# started. Caddy starts with /etc/caddy/plugins.caddy present, and this runtime
# apply updates that plugin-owned file plus generated supervisor programs when
# artifacts become available.

VD_PLUGIN_ORCHESTRATOR_INSTALL_ARTIFACTS=true \
  node --experimental-strip-types /opt/vibe-kanban-vscode-web-seed/plugins/orchestrator/plugin-service-orchestrator-cli.ts apply \
    --catalog /opt/vibe-kanban-vscode-web-seed/plugins/builtin.plugins.json \
    --optional-catalog /var/lib/vd/instance-config/plugins.json \
    --artifact-cache-root /var/lib/vd/plugin-cache \
    --install-root /var/lib/vd/plugins \
    --supervisor-config-dir /etc/supervisor/conf.d/vd-generated \
    --caddy-plugin-config-path /etc/caddy/plugins.caddy \
    --caddy-config-path /etc/caddy/Caddyfile

supervisorctl reread
supervisorctl update

# Caddy is intentionally kept up during plugin installation. Once plugin-owned
# routes are generated, reload Caddy in-place so new plugin subdomains activate
# without restarting the container.
reload_caddy_with_retry
