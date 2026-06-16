#!/bin/sh
set -eu

# Reconcile plugin services after the core supervisor-managed services have
# started. Caddy starts with /etc/caddy/plugins.caddy present, and this runtime
# apply updates that plugin-owned file plus generated supervisor programs when
# artifacts become available.

VD_PLUGIN_ORCHESTRATOR_INSTALL_ARTIFACTS=true \
  node --experimental-strip-types /opt/vibe-kanban-vscode-web-seed/src/modules/plugins/vibe-dashboard/plugin-service-orchestrator-cli.ts apply \
    --catalog /opt/vibe-kanban-vscode-web-seed/src/modules/plugins/vibe-dashboard/plugins.json \
    --optional-catalog /var/lib/vd/instance-config/plugins.json \
    --artifact-cache-root /var/lib/vd/plugin-cache \
    --install-root /var/lib/vd/plugins \
    --supervisor-config-dir /etc/supervisor/conf.d/vd-generated \
    --caddy-plugin-config-path /etc/caddy/plugins.caddy

supervisorctl reread
supervisorctl update

# Caddy is intentionally kept up during plugin installation. Once plugin-owned
# routes are generated, reload Caddy in-place so new plugin subdomains activate
# without restarting the container.
caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
