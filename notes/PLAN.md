# VD Plugin System — Multi-Phase Plan

## Current State Analysis

### Config scattered across files
| File | What it configures |
|---|---|
| `Dockerfile.vkvd` | Canonical runtime image config: installs code-server, Go, Hugo, Chrome, Caddy, Docker CLI, Tailscale, supervisor, vibe-kanban, vibe-dashboard — all hardcoded |
| `supervisord.vkvd.conf` | Canonical supervisor config: code-server (:3008), vibe-kanban (:3007), vibe-dashboard (:3005), caddy (:3001), test-server (:50000), tailscaled, tailscale-up |
| `Caddyfile` | Routes traffic: port-forwarding subdomains, `/dashboard` → :3005, `?folder=` → :3008, fallback → :3007 |
| `docker-compose.yaml` | Single `code-vibe` service with env vars for ports and passwords |
| `src/components/AddTabModal.tsx` | Hardcoded presets: "Code Server", "Kanban", "Open Existing Workspace", "Custom URL" |
| `src/components/dialogs/AddVKWorkspaceModal.tsx` | Hardcoded `/api/task-attempts` integration |

### Springboard module system (existing)
- Single `workspace` module in `src/index.tsx` handles everything
- `moduleAPI.getModule('name')` for cross-module communication with type-safe interface merging
- `statesAPI.createPersistentState()` / `createSharedState()` / `createUserAgentState()`
- `moduleAPI.createActions()` for RPC-enabled actions
- `moduleAPI.registerRoute()` for route registration
- Module types: Feature (UI+routes), Utility (shared services), Initializer (setup)

---

## Architecture Vision

### YAML Plugin Descriptor (`plugin.yaml`)
Each plugin declares its infrastructure contributions in a single file:

```yaml
# plugins/vscode/plugin.yaml
name: vscode
version: "1.0.0"
description: "VS Code Server (code-server)"

# Infrastructure layer — generates Dockerfile fragments, supervisor, caddy
infra:
  dockerfile:
    snippets:
      - order: 100
        cache_group: "system-deps"
        run: |
          apt-get update && apt-get install -y curl
      - order: 200
        run: |
          curl -fsSL https://code-server.dev/install.sh | sh

  supervisor:
    program: code-server
    command: "code-server --bind-addr 0.0.0.0:{{port}} --idle-timeout-seconds=3600"
    port: 3008
    user: vkuser
    autostart: true
    autorestart: true
    environment:
      PASSWORD: "%(ENV_CODE_PASSWORD)s"
    stopasgroup: true
    killasgroup: true

  caddy:
    blocks:
      - section: "site:3001"
        order: 310
        block: |
          @vscode_query {
            query folder=*
          }
          handle @vscode_query {
            reverse_proxy localhost:{{port}} {
              header_up Host {upstream_hostport}
              header_up Upgrade {http.request.header.Upgrade}
              header_up Connection {http.request.header.Connection}
            }
          }
      - section: "site:3001"
        order: 320
        block: |
          @vscode_assets {
            path /stable-*
            path /vscode-remote-resource*
          }
          handle @vscode_assets {
            reverse_proxy localhost:{{port}} {
              header_up Host {upstream_hostport}
            }
          }
```

### TypeScript Plugin Modules
Each plugin provides a Springboard module that registers UI contributions:

```typescript
// plugins/vscode/module.tsx
import springboard from 'springboard';

springboard.registerModule('plugin-vscode', {}, async (moduleAPI) => {
  const pluginRegistry = moduleAPI.getModule('plugin-registry');

  pluginRegistry.actions.registerTabPreset({
    key: 'code',
    title: 'Code Server',
    icon: '</>',
    urlTemplate: '{{origin}}/?folder={{path}}',
  });

  pluginRegistry.actions.registerSpaceType({
    key: 'code',
    icon: '</> ',
  });

  return {};
});
```

### Generated Outputs
A CLI tool (`vd-plugins`) reads all `plugin.yaml` files and generates:
1. **Dockerfile.vkvd** — assembled from base + plugin `dockerfile.snippets`; snippets are sorted by `order` and can be grouped by `cache_group` to maximize BuildKit cache reuse
2. **supervisord.vkvd.conf** — assembled from base config + plugin supervisor program sections (each plugin's YAML defines its program block)
3. **Caddyfile** — assembled from global config + ordered plugin `caddy.blocks` inserted into named sections (supports precedence-sensitive handlers)
4. **`src/modules/plugins/index.ts`** — hand-maintained TypeScript import list for plugin UI modules (manual wiring in app source)

### Explicit Non-Goals
- `docker-compose.yaml` remains a single hand-maintained file for runtime ports/env/volumes; plugin descriptors do not generate compose fragments.

---

## Phases

### Phase 1: Plugin Schema & Generator CLI
**Branch:** `vk/c561-vd-plugin-system` (this branch)

Create the plugin descriptor format and the CLI that reads YAML and generates config files.

1. Define the `plugin.yaml` JSON Schema (validates plugin descriptors)
2. Create `tools/vd-plugins/` — a TypeScript CLI using `yaml`, `ajv`, `handlebars`
3. Implement generators:
   - `generate-dockerfile` — reads all plugin yamls, sorts `infra.dockerfile.snippets` by `order`, and emits cached layers grouped by `cache_group`
   - `generate-supervisor` — reads each plugin's `infra.supervisor` YAML and outputs a complete `supervisord.vkvd.conf`
   - `generate-caddy` — inserts ordered `infra.caddy.blocks` into named Caddyfile sections
4. Create `plugins/` directory with initial plugin descriptors extracted from current config:
   - `plugins/base/plugin.yaml` — Node, common packages, user setup
   - `plugins/vscode/plugin.yaml` — code-server
   - `plugins/vibe-kanban/plugin.yaml` — vibe-kanban service
   - `plugins/vibe-dashboard/plugin.yaml` — vibe-dashboard service
   - `plugins/caddy/plugin.yaml` — Caddy reverse proxy (base routing)
   - `plugins/tailscale/plugin.yaml` — Tailscale VPN
5. Verify generated files match current working config (diff test)
   - Generated `supervisord.vkvd.conf` ≡ current canonical `supervisord.vkvd.conf` for the default deployment
   - Generated `Dockerfile.vkvd` and Caddyfile are functionally equivalent to current files

**Deliverable:** `npx vd-plugins generate` produces identical (or functionally equivalent) Dockerfile.vkvd, supervisord.vkvd.conf, and Caddyfile for the default deployment path. Supervisor programs are fully defined in plugin YAML — no runtime generation scripts. `docker-compose.yaml` remains a single static file managed outside plugin generation.

---

### Phase 2: Plugin Registry & Manual Module Registration
**Branch:** new workspace from this branch

Refactor vibe-dashboard from a monolithic module to a plugin-aware architecture with explicit module registration.

1. Create `plugin-registry` utility module (`src/modules/plugin-registry/`):
   - Shared state: `registeredPlugins`, `tabPresets`, `spaceTypes`, `tabGroupFactories`
   - Actions: `registerTabPreset`, `registerSpaceType`, `registerTabGroupFactory`, `registerContextMenuItem`
   - Type-safe `AllModules` interface declaration
2. **Implement manual plugin module registration:**
   - Add a hand-maintained `src/modules/plugins/index.ts` that imports plugin modules in explicit order
   - `src/index.tsx` imports this file once to activate plugin modules
   - Adding a new plugin requires one source edit in `src/modules/plugins/index.ts`
3. Refactor `workspace` module to consume `plugin-registry`:
   - `AddTabModal` reads presets from `plugin-registry` state instead of hardcoded array
   - `Sidebar` reads space icons from `plugin-registry` state
   - `TabContextMenu` reads extra menu items from `plugin-registry`
4. Extract VK Workspace logic into a plugin module (`src/modules/plugins/vk-workspace/`):
   - Moves `AddVKWorkspaceModal` and `/api/task-attempts` integration out of workspace
   - Registers itself with `plugin-registry` on load
   - Add manual import for the module in `src/modules/plugins/index.ts`

**Deliverable:** Dashboard UI is driven by plugin-registry state. Adding a new tab preset = registering with the registry. Zero hardcoded service references in workspace module. Plugin modules are wired explicitly through app source imports.

---

### Phase 3: Core Service Plugins (TypeScript UI)
**Branch:** new workspace, parallel work possible

Create Springboard modules for each core service, each registering UI contributions.

1. `plugins/vscode/module.tsx` — registers "Code Server" tab preset, `</>` space icon
2. `plugins/vibe-kanban/module.tsx` — registers "Kanban" tab preset, kanban space icon
3. `plugins/vibe-dashboard/module.tsx` — self-registration (dashboard chrome, spaces overview)
4. Add each new module to `src/modules/plugins/index.ts` so it is imported and registered at app startup

**Deliverable:** Each service has its own isolated module. New services are added by creating plugin infra YAML plus a TypeScript module and wiring that module in `src/modules/plugins/index.ts`.

---

### Phase 4: Tab Group Factories & Composite Plugins
**Branch:** new workspace

Enable plugins that create structured tab groups (multi-tab layouts).

1. Add `TabGroupFactory` concept to plugin-registry:
   - A factory creates a pre-configured tab group with multiple tabs and pairs
   - Example: "App Development" factory creates: Agent tab + Code tab (pair), Kanban tab
2. Refactor "Open Existing Workspace" into a tab group factory:
   - VK Workspace plugin registers a factory that creates agent+code pairs
3. Add "New Tab Group from Template" UI in sidebar/workspace:
   - Lists all registered factories
   - User picks one, fills parameters (e.g., workspace name, folder path)
   - Factory creates the tab group
4. Create `app-development` composite plugin:
   - Depends on: `vscode`, `vibe-kanban`
   - Registers a factory: "App Workspace" = kanban tab + code tab + preview tab

**Deliverable:** Structured multi-tab layouts are created via plugin-registered factories. The "Open Existing Workspace" flow is a factory, not special-cased UI.

---

### Phase 5: Dev Server Manager Plugin
**Branch:** new workspace

Plugin for managing development servers running inside the container.

1. Create `plugins/dev-server-manager/plugin.yaml` — no infra needed (uses existing Node)
2. Create `src/modules/plugins/dev-server-manager/`:
   - State: tracked dev servers (pid, port, command, status, log tail)
   - Actions: `startServer`, `stopServer`, `restartServer`, `listServers`
   - Tab preset: "Dev Server" — shows management UI (React component via `internal://` URL)
   - Auto-detect: watches for port listeners, suggests adding to tracked list
3. Integrate with Caddy port-forwarding:
   - Dev servers automatically get `port-{N}.hostname` subdomain routing
4. Register as tab group factory:
   - "Dev Environment" = Code tab + Dev Server panel + Preview tab (at forwarded port)

**Deliverable:** Users can start/stop/monitor dev servers from a dashboard tab. Dev servers integrate with Caddy port forwarding automatically.

---

### Phase 6: Supervisorctl Manager Plugin
**Branch:** new workspace, parallel with Phase 5

Plugin for managing supervisor-controlled services from the dashboard.

1. Create `plugins/supervisorctl-manager/plugin.yaml`:
   - Infra: installs `supervisor` XML-RPC client
   - Supervisor: no new program (it manages existing ones)
2. Create `src/modules/plugins/supervisorctl-manager/`:
   - State: service statuses (fetched via supervisor XML-RPC or `supervisorctl status` parsing)
   - Actions: `startProgram`, `stopProgram`, `restartProgram`, `getStatus`, `tailLog`
   - Tab preset: "Services" — renders management UI
   - Registers context menu items on service-related tabs (e.g., "Restart code-server")
3. Server module (Hono routes):
   - `GET /api/supervisor/status` — returns all program statuses
   - `POST /api/supervisor/:program/start|stop|restart`
   - `GET /api/supervisor/:program/logs` — SSE stream of stdout/stderr

**Deliverable:** Full supervisor management from within the dashboard UI.

---

### Phase 7: Testing Plugins (Vitest + E2E)
**Branch:** new workspace, parallel

1. `plugins/vitest/plugin.yaml`:
   - Infra: vitest installed as dev dependency
   - Supervisor: optional test watcher program
2. `src/modules/plugins/vitest/`:
   - Tab preset: "Test Runner" — vitest UI or custom component
   - Tab preset: "Coverage Report" — coverage HTML viewer
   - Tab group factory: "Test Suite" = test runner + coverage + code
3. `plugins/e2e-testing/plugin.yaml`:
   - Infra: playwright or cypress
   - Supervisor: optional E2E runner
4. `src/modules/plugins/e2e-testing/`:
   - Similar structure to vitest but for E2E

**Deliverable:** Test runners and coverage viewers as dashboard plugins.

---

### Phase 8: Platform Plugins (Mobile + Desktop)
**Branch:** new workspace, parallel

1. `plugins/mobile-dev/plugin.yaml`:
   - Infra: Android SDK / iOS simulator tooling
   - Supervisor: optional emulator process
2. `src/modules/plugins/mobile-dev/`:
   - Tab preset: "Mobile Preview" — emulator viewer
   - Tab group factory: "Mobile App Dev" = code + mobile preview + device logs
3. `plugins/desktop-dev/plugin.yaml`:
   - Infra: Tauri / Electron tooling
   - Supervisor: optional desktop app process
4. `src/modules/plugins/desktop-dev/`:
   - Tab group factory: "Desktop App Dev" = code + desktop preview

---

### Phase 9: External Service Plugins
**Branch:** new workspace, parallel

1. `plugins/mattermost/plugin.yaml` + module — chat integration tab
2. `plugins/silverbullet/plugin.yaml` + module — note-taking/wiki tab
3. `plugins/vibe-agent/plugin.yaml` + module — AI agent interface

Each follows the established pattern: YAML for infra, TypeScript module for UI registration.

---

### Phase 10: Plugin Writer Plugin
**Branch:** new workspace

Meta-plugin for creating new plugins from within the dashboard.

1. `src/modules/plugins/plugin-writer/`:
   - Tab preset: "Plugin Writer" — form-based plugin.yaml editor
   - Generates plugin.yaml from user input
   - Generates skeleton Springboard module
   - Preview: shows what would be generated (Dockerfile.vkvd diff, supervisor diff, etc.)
   - Emits a checklist + patch preview for manual module wiring in `src/modules/plugins/index.ts`
   - Actions: `createPlugin`, `validatePlugin`, `previewGenerated`
2. Manual integration support:
   - Generated plugins are not auto-loaded from YAML
   - Plugin Writer shows required manual import/order edits before merge

**Deliverable:** Users can create new plugins from within the dashboard UI.

---

### Phase 11: User-Created Plugins & Plugin Marketplace
**Branch:** new workspace

1. Plugin validation and sandboxing
2. Plugin sharing (export/import as tarballs or git repos)
3. Optional: plugin registry/marketplace UI for curated templates
4. Maintainer-approved import flow (explicit source wiring, no runtime auto-discovery)

---

## Parallel Execution Map

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
                                  ├──→ Phase 5  ─┐
                                  ├──→ Phase 6  ─┤
                                  ├──→ Phase 7  ─┤──→ Phase 10 ──→ Phase 11
                                  ├──→ Phase 8  ─┤
                                  └──→ Phase 9  ─┘
```

- **Phases 1→2→3→4** are sequential (each builds on the previous)
- **Phases 5-9** are parallel (independent plugins using the established pattern)
- **Phase 10** needs the pattern stabilized (after a few plugins exist)
- **Phase 11** is the capstone

## Workspace Strategy

Each phase gets its own vibe-kanban workspace branch. Parallel phases (5-9) can be worked on simultaneously in separate workspaces. The plugin system's own architecture makes this natural — each plugin is isolated, so merge conflicts are minimal.
