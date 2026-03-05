# VD Plugin System — Multi-Phase Plan

## Current State Analysis

### Config scattered across files
| File | What it configures |
|---|---|
| `Dockerfile` | Monolithic: installs code-server, Go, Hugo, Chrome, Caddy, Docker CLI, Tailscale, supervisor, vibe-kanban, vibe-dashboard — all hardcoded |
| `supervisord.conf` | 7 programs: code-server (:3008), vibe-kanban (:3007), vibe-dashboard (:3005), caddy (:3001), test-server (:50000), tailscaled, tailscale-up |
| `Caddyfile` | Routes traffic: port-forwarding subdomains, `/dashboard` → :3005, `?folder=` → :3008, fallback → :3007 |
| `docker-compose.yaml` | Single `code-vibe` service with env vars for ports and passwords |
| `src/components/AddTabModal.tsx` | Hardcoded presets: "Code Server", "Kanban", "Open Existing Workspace", "Custom URL" |
| `src/components/dialogs/AddVKWorkspaceModal.tsx` | Hardcoded `/api/task-attempts` integration |
| `generate-supervisor-configs.sh` | Multi-tenant supervisor generation (out of scope — separate concern) |

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
Each plugin declares its infrastructure and UI contributions in a single file:

```yaml
# plugins/vscode/plugin.yaml
name: vscode
version: "1.0.0"
description: "VS Code Server (code-server)"

# Infrastructure layer — generates Dockerfile fragments, supervisor, caddy, compose
infra:
  dockerfile:
    packages: [curl]
    install: |
      curl -fsSL https://code-server.dev/install.sh | sh
    expose: [3008]

  supervisor:
    program: code-server
    command: "code-server --bind-addr 0.0.0.0:{{port}} --idle-timeout-seconds=3600"
    port: 3008
    user: vkuser
    autostart: true
    autorestart: true
    environment:
      PASSWORD: "{{env.CODE_PASSWORD}}"
    stopasgroup: true
    killasgroup: true

  caddy:
    routes:
      - match: { query: "folder=*" }
        upstream: "localhost:{{port}}"
      - match: { path: ["/stable-*", "/vscode-remote-resource*"] }
        upstream: "localhost:{{port}}"

  compose:
    ports:
      - "${VS_CODE_PORT:-3008}:3008"
    environment:
      - CODE_PASSWORD

# UI layer — what this plugin contributes to vibe-dashboard
ui:
  module: "./module.tsx"        # Springboard module file
  depends_on: []                # Other plugins that must load first
  tab_presets:
    - key: code
      title: "Code Server"
      icon: "</>"
      url_template: "{{origin}}/?folder={{path}}"
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
1. **Dockerfile** — assembled from base + plugin install fragments
2. **supervisord.conf** — assembled from base config + plugin supervisor program sections (each plugin's YAML defines its program block)
3. **Caddyfile** — assembled from global config + plugin route fragments
4. **docker-compose.override.yaml** — merged port/env/volume declarations, automatically included by all compose entrypoints
5. **src/generated/plugin-loader.ts** — auto-import file that discovers and loads all `ui.module` entries in dependency order (replaces manual wiring in `src/index.tsx`)

---

## Phases

### Phase 1: Plugin Schema & Generator CLI
**Branch:** `vk/c561-vd-plugin-system` (this branch)

Create the plugin descriptor format and the CLI that reads YAML and generates config files.

1. Define the `plugin.yaml` JSON Schema (validates plugin descriptors)
2. Create `tools/vd-plugins/` — a TypeScript CLI using `yaml`, `ajv`, `handlebars`
3. Implement generators:
   - `generate-dockerfile` — reads all plugin yamls, outputs `Dockerfile`
   - `generate-supervisor` — reads each plugin's `infra.supervisor` YAML and outputs a complete `supervisord.conf`
   - `generate-caddy` — outputs `Caddyfile`
   - `generate-compose` — outputs `docker-compose.override.yaml`
4. **Wire generated compose override into runtime workflows:**
   - Update `docker-compose.yaml` to reference the generated override: add `-f docker-compose.override.yaml` to the default compose command chain
   - Update any startup scripts / entrypoints that invoke `docker-compose` to include the override file
   - Add a `generate` step to the Dockerfile build so the override is always present at image build time
   - Document in README that `npx vd-plugins generate` must be run before `docker-compose up` (or is run automatically by the build)
5. Create `plugins/` directory with initial plugin descriptors extracted from current config:
   - `plugins/base/plugin.yaml` — Node, common packages, user setup
   - `plugins/vscode/plugin.yaml` — code-server
   - `plugins/vibe-kanban/plugin.yaml` — vibe-kanban service
   - `plugins/vibe-dashboard/plugin.yaml` — vibe-dashboard service
   - `plugins/caddy/plugin.yaml` — Caddy reverse proxy (base routing)
   - `plugins/tailscale/plugin.yaml` — Tailscale VPN
6. Verify generated files match current working config (diff test)
   - Generated `supervisord.conf` ≡ current static `supervisord.conf` (note: `generate-supervisor-configs.sh` is a separate multi-tenant concern and is not migrated here)
   - Generated Dockerfile, Caddyfile, compose override are functionally equivalent to current files

**Deliverable:** `npx vd-plugins generate` produces identical (or functionally equivalent) Dockerfile, supervisord.conf, Caddyfile, and docker-compose fragments to what exists today. Supervisor programs are fully defined in plugin YAML — no runtime generation scripts. The generated compose override is wired into all runtime entrypoints.

---

### Phase 2: Plugin Registry & Descriptor-Driven Module Loading
**Branch:** new workspace from this branch

Refactor vibe-dashboard from a monolithic module to a plugin-aware architecture with automatic module discovery.

1. Create `plugin-registry` utility module (`src/modules/plugin-registry/`):
   - Shared state: `registeredPlugins`, `tabPresets`, `spaceTypes`, `tabGroupFactories`
   - Actions: `registerTabPreset`, `registerSpaceType`, `registerTabGroupFactory`, `registerContextMenuItem`
   - Type-safe `AllModules` interface declaration
2. **Implement descriptor-driven plugin module loading:**
   - Add a build-time plugin discovery step: the `vd-plugins` CLI (from Phase 1) scans all `plugin.yaml` files for `ui.module` entries and generates a `src/generated/plugin-loader.ts` file that imports and registers all plugin modules in dependency order
   - The generated loader replaces manual wiring in `src/index.tsx` — no source edits needed to add new plugins
   - Dependency resolution: plugins can declare `ui.depends_on: [plugin-name]` in their YAML; the loader topologically sorts imports
   - The Vite build includes `vd-plugins generate-loader` as a pre-build step so the loader is always fresh
   - This is critical for Phase 10 (plugin writer) and Phase 11 (user plugins) — without it, new plugins would still require manual source edits and rebuilds
3. Refactor `workspace` module to consume `plugin-registry`:
   - `AddTabModal` reads presets from `plugin-registry` state instead of hardcoded array
   - `Sidebar` reads space icons from `plugin-registry` state
   - `TabContextMenu` reads extra menu items from `plugin-registry`
4. Extract VK Workspace logic into a plugin module (`src/modules/plugins/vk-workspace/`):
   - Moves `AddVKWorkspaceModal` and `/api/task-attempts` integration out of workspace
   - Registers itself with `plugin-registry` on load
   - Its `plugin.yaml` declares `ui.module: "./module.tsx"` — loaded automatically by the generated loader

**Deliverable:** Dashboard UI is driven by plugin-registry state. Adding a new tab preset = registering with the registry. Zero hardcoded service references in workspace module. New plugins are discovered from their YAML descriptors — no manual import wiring needed.

---

### Phase 3: Core Service Plugins (TypeScript UI)
**Branch:** new workspace, parallel work possible

Create Springboard modules for each core service, each registering UI contributions.

1. `plugins/vscode/module.tsx` — registers "Code Server" tab preset, `</>` space icon
2. `plugins/vibe-kanban/module.tsx` — registers "Kanban" tab preset, kanban space icon
3. `plugins/vibe-dashboard/module.tsx` — self-registration (dashboard chrome, spaces overview)
4. Each plugin's `plugin.yaml` already declares `ui.module` — the descriptor-driven loader from Phase 2 automatically discovers and imports them (no manual `src/index.tsx` edits)

**Deliverable:** Each service has its own isolated module. New services added by creating a `plugin.yaml` with a `ui.module` entry — the build pipeline handles the rest.

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
   - Preview: shows what would be generated (Dockerfile diff, supervisor diff, etc.)
   - Actions: `createPlugin`, `validatePlugin`, `previewGenerated`
2. Hot-reload support:
   - New UI-only plugins can register at runtime
   - Infra changes require rebuild (shown as "needs rebuild" indicator)

**Deliverable:** Users can create new plugins from within the dashboard UI.

---

### Phase 11: User-Created Plugins & Plugin Marketplace
**Branch:** new workspace

1. Plugin loading from user directories (`~/plugins/`)
2. Plugin validation and sandboxing
3. Plugin sharing (export/import as tarballs or git repos)
4. Optional: plugin registry/marketplace UI

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
