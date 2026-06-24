# Plugin runtime operations

This document defines the operator-facing lifecycle semantics for VD plugin
services. The runtime is intentionally declarative: operators and agents change
desired plugin state, then the sync/apply loop reconciles plugin-owned runtime
files and services to match that state.

## Desired state source of truth

Per-instance plugin configuration lives in the instance config repository,
normally `/var/lib/vd/instance-config/plugins.json`. Plugin manifests are listed
under `plugins`, and durable enablement state is listed under `pluginStates`:

```json
{
  "plugins": [
    {
      "id": "vd.beads-web",
      "name": "Beads Web",
      "version": "0.11.4",
      "installers": [],
      "services": []
    }
  ],
  "pluginStates": {
    "vd.beads-web": { "enable": false }
  }
}
```

`pluginStates[pluginId].enable` has these meanings:

- `true`: the plugin is enabled. Sync/apply generates the plugin-owned
  Supervisor programs and Caddy exposure for that plugin and self-heals enabled
  autostart services back to `RUNNING` if they were temporarily stopped.
- `false`: the plugin is disabled. Sync/apply removes that plugin's generated
  Supervisor programs and Caddy exposure. Persistent plugin artifacts, cached
  downloads, package-manager toolchains, and plugin data are retained so the
  plugin can be re-enabled without treating disablement as uninstall/delete.
- missing `pluginStates` entry: default enabled. A checked-in or per-instance
  plugin manifest without an explicit state is treated the same as
  `{ "enable": true }`.

Use the Plugin Admin UI or `vibe-agent plugins enable|disable --plugin-id <id>`
to change persistent state. Do not hand-edit `plugins.json` unless you are
repairing the instance config repository itself.

## Sync/apply boundary

`vd-plugin-runtime-apply.sh` composes checked-in plugin metadata with the
per-instance catalog, materializes plugin artifacts, writes generated plugin
Supervisor configs under `/etc/supervisor/conf.d/vd-generated`, writes the
plugin-owned Caddy import at `/etc/caddy/plugins.caddy`, runs
`supervisorctl reread`/`update`, starts enabled plugin autostart programs that
are not running, and reloads Caddy.

The apply step only reconciles plugin-owned resources:

- generated Supervisor configs whose program names use the
  `vd-plugin--<plugin>--<service>` convention,
- generated Caddy routes in `/etc/caddy/plugins.caddy`,
- plugin artifact/cache/bin/toolchain paths under `/var/lib/vd`.

It does not restart or repair unrelated Supervisor programs such as dashboard,
code-server, Vibe Kanban, Tailscale, memory-watchdog, or other core services.

## Temporary debugging stops

`supervisorctl stop vd-plugin--<plugin>--<service>` is only a temporary
debugging action for an enabled plugin. Because enabled state is declarative,
the next runtime apply may start that program again. To keep a plugin stopped
across sync/apply runs, set `pluginStates[pluginId].enable` to `false` through
the Plugin Admin UI or `vibe-agent plugins disable --plugin-id <id>`.

Disabled plugins retain installed artifacts and data. Re-enabling the plugin
sets `pluginStates[pluginId].enable` back to `true`; the next sync/apply will
restore the generated Supervisor/Caddy resources and start enabled autostart
services.

