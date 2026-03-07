# App Plugin Extraction Plan (Runtime-Extensible, App-First)

## Scope

This plan is separate from `PLAN.md` and focuses on:

1. Keeping Docker/install concerns hardcoded in-repo.
2. Keeping one primary Supervisor config with optional runtime extension files mounted via volume.
3. Implementing app-level plugins in `src` for:
   - `vibe-dashboard` (plugin registry + shared contracts)
   - `code-server`
   - `vibe-kanban`
   - `app-development` (composite factory)

## Non-Goals

1. No infra code generation.
2. No multi-tenant/domain fan-out logic.
3. No automatic plugin discovery from YAML.
4. No external plugin install automation beyond documented volume-based extension points.

## What `src` Currently Looks Like (Audit Summary)

1. Monolithic module:
   - `src/index.tsx` contains state, actions, VK workspace flow, and route registration.
2. Hardcoded tab/service presets:
   - `src/components/AddTabModal.tsx` has fixed entries for Code Server, Kanban, VK Workspace, Custom URL.
3. Hardcoded icon mapping:
   - `src/components/Sidebar.tsx` has static `SPACE_ICONS`.
4. VK workspace logic is tightly coupled:
   - API calls in `src/components/dialogs/AddVKWorkspaceModal.tsx`.
   - `addVKWorkspace` action in `src/index.tsx`.
5. No plugin registry abstraction yet:
   - Components consume direct actions/state, not registered contributions.
6. Internal screens are special-cased:
   - `src/components/IframePanel.tsx` resolves `internal://spaces-overview` directly.

## Target Architecture (App Layer)

1. Manual plugin wiring via source imports:
   - Add `src/modules/plugins/index.ts` that imports plugin modules in explicit order.
2. `vibe-dashboard` plugin owns plugin-registry:
   - Registry for tab presets, space icons, and tab-group factory templates.
3. Service plugins only register contributions:
   - `code-server` plugin registers its preset/icon metadata.
   - `vibe-kanban` plugin registers its preset/icon metadata.
4. `app-development` plugin registers a factory:
   - Creates preconfigured tab group(s) (Agent + Code + Kanban, as defined by product decisions).
5. Workspace shell components become consumers of registry state:
   - No static `PRESETS` in `AddTabModal`.
   - No static `SPACE_ICONS` in `Sidebar`.

## Runtime Extension Model (Supervisor + Volumes)

### Supervisor

Keep all existing core services in the main `supervisord.conf`, and add include support for extension files:

```ini
[include]
files = /etc/supervisor/conf.d/extensions/*.conf
```

### Docker Compose

Keep one compose file. Add optional mounts for runtime extension:

1. `./supervisor.d:/etc/supervisor/conf.d/extensions:ro`
2. `./plugins:/opt/vibe-plugins:ro` (for runtime scripts/assets/docs installed via volumes)

Notes:
1. Core services remain in main config.
2. External plugins that need extra processes or artifacts do so through mounted volumes and extension files.

## Phased Implementation Plan

### Phase 0: Stabilize Runtime Extension Rails

1. Update `supervisord.conf` with `[include]` extension directory.
2. Ensure extension directory exists in image/startup flow.
3. Update `docker-compose.yaml` with optional extension volumes.
4. Document extension conventions in README:
   - File naming
   - Required fields
   - Restart flow (`supervisorctl reread && supervisorctl update`)

Acceptance:
1. Existing services behave unchanged with no extension files present.
2. Dropping a valid `.conf` file into mounted extension directory starts the new program.

### Phase 1: Introduce Plugin Registry (vibe-dashboard plugin core)

1. Create `src/modules/plugins/vibe-dashboard/` with:
   - registry types
   - state/actions for registering:
     - tab presets
     - space icon mappings
     - tab-group factories
2. Add `src/modules/plugins/index.ts` and import `vibe-dashboard` first.
3. Update `src/index.tsx`:
   - keep workspace state/actions, but consume registry module for plugin-contributed UI data.
4. Define minimal interfaces for contributions (no YAML dependency).

Acceptance:
1. App boots with registry available.
2. Existing behavior preserved using temporary seed registrations (same presets/icons as today).

### Phase 2: Extract `code-server` Plugin

1. Create `src/modules/plugins/code-server/`.
2. Register:
   - tab preset (`Code Server`)
   - optional space icon key metadata used by Sidebar.
3. Remove code-server-specific hardcoding from:
   - `AddTabModal`
   - any workspace action wrappers that are preset-specific.

Acceptance:
1. Code tab can be created from plugin registration only.
2. No hardcoded code-server preset data remains in modal source.

### Phase 3: Extract `vibe-kanban` Plugin

1. Create `src/modules/plugins/vibe-kanban/`.
2. Register:
   - tab preset (`Kanban`)
   - associated icon metadata.
3. Remove remaining hardcoded Kanban preset references.

Acceptance:
1. Kanban tab creation is registry-driven.
2. Removing the plugin import removes the feature cleanly.

### Phase 4: Extract `app-development` Composite Plugin

1. Create `src/modules/plugins/app-development/`.
2. Register a tab-group factory:
   - builds the default multi-tab workflow composition.
3. Move VK workspace-oriented orchestration out of monolith:
   - keep API transport in dedicated plugin-layer code (or adjacent plugin util).
4. Update `AddTabModal` to show factory actions from registry instead of fixed list entry.

Acceptance:
1. “Open Existing Workspace” style flow is provided by plugin factory registration.
2. Workspace module no longer contains composite-flow specific assembly logic.

### Phase 5: Extract Remaining `vibe-dashboard` App Shell Ownership

1. Move plugin-registry-aware UI ownership into `vibe-dashboard` plugin boundaries:
   - Sidebar icon sourcing
   - tab creation menu sourcing
   - context menu extension points (if needed now)
2. Keep `src/index.tsx` focused on wiring root module + route registration + manual plugin imports.

Acceptance:
1. `src/index.tsx` is orchestration-focused, not feature-heavy.
2. Plugin contributions drive user-visible app options.

## Concrete `src` Refactors (Order-Sensitive)

1. Add new module tree:
   - `src/modules/plugins/vibe-dashboard/`
   - `src/modules/plugins/code-server/`
   - `src/modules/plugins/vibe-kanban/`
   - `src/modules/plugins/app-development/`
   - `src/modules/plugins/index.ts`
2. Replace static preset source in `AddTabModal`.
3. Replace static icon mapping in `Sidebar`.
4. Move `addVKWorkspace` assembly logic behind plugin-facing factory/action APIs.
5. Keep `IframePanel` internal view behavior unchanged initially, then optionally fold into dashboard plugin internals later.

## Risks and Mitigations

1. Risk: Breaking tab/session behavior while moving actions out of monolith.
   - Mitigation: extract registration first, keep workspace actions stable until factory migration.
2. Risk: Regression in VK workspace flow.
   - Mitigation: preserve API contract and add focused manual QA checklist before/after extraction.
3. Risk: Circular dependency between workspace module and registry plugin.
   - Mitigation: registry exposes narrow interfaces; workspace consumes via `getModule` lazily in actions/routes.

## Validation Checklist

1. Can still create spaces and tab groups.
2. Can add Code and Kanban tabs from plugin-registered presets.
3. Can run app-development composite flow and get expected multi-tab layout.
4. Home/overview internal tab still renders.
5. App starts with only core plugins imported; features disappear predictably when plugin import is removed.
6. Supervisor starts with no extensions and with mounted extension files.
