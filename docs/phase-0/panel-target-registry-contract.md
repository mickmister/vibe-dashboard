# Phase 0 Panel target registry contract

Status: **GO**, as an isolated contract for the production registry in M2.3.

Evidence: `spikes/dockview-contract/targetRegistry.ts` and
`targetRegistry.test.ts`, exercised by `pnpm test:contract:dockview`.

## Repository inventory

The inventory follows construction, effective-view generation, and rendering
through `types.ts`, `AddTabModal`, the plugin registry, `craft-surfaces`,
`workspace-composition`, and `IframePanel`. Every currently constructible family
has one target-model outcome:

| Current producer | Current representation | Phase 0 outcome |
| --- | --- | --- |
| VK Workspace Agent | Generated `agent` View from stable Workspace metadata | Durable `workspace-surface` target using `workspaceId` + `builtin/agent` |
| Code | Generated `code` View; URL currently contains `workspaceDir` | Durable `workspace-surface` target using `workspaceId` + `builtin/code`; current container reference is re-derived |
| Beads | Generated `beads` View | Durable `workspace-surface` target using `workspaceId` + `builtin/beads` |
| Forms | Generated `forms` View | Durable `workspace-surface` target using `workspaceId` + `builtin/forms` |
| Custom URL | Manual Add Tab or `code-server` URL-prompt preset | Durable `custom-url` request; the trusted URL resolver validates and derives effective provenance/capabilities |
| Craft-surface plugin iframe | Manifest `craftSurfaces`, including `code-server/editor` | Durable `plugin-surface` lookup; installed manifest supplies renderer and URL template |
| Craft-surface plugin React | `preview-server/run-configs`, recognized by the first-party React surface map | Durable `plugin-surface`; currently classified recreatable-transient for Split View because no stable leaseable React root exists |
| Plugin internal iframe route | Installed manifest `internalRoutes` resolved from `internal://` | Durable `plugin-surface`; missing route/manifest is unavailable, never a generic iframe fallback |
| Workspace factory | `app-development/open-existing-workspace` composition creates Agent + Code Views | Factory identity and tab key map to the same canonical built-in targets; expanded template URLs are ignored |
| Pair | Built-in Agent+Code / Agent+Beads or user-created `ViewPair` | Placement-only migration input referencing Panels; never a Panel target |
| Spaces Overview | `internal://spaces-overview` in the system Home Craft | Homepage/overview state; never a Dockview Panel |
| Create Workspace | Pending action surface in `WorkspaceShell` | Skip as temporary UI; never a Craft or Panel |
| Generated ephemeral surface | Runtime `ephemeral.kind = craft-surface` View | Recreate from the current installed surface definition; do not persist the expanded View URL |
| Unknown internal, removed plugin/factory, or unresolved ephemeral View | No trusted current definition | Quarantine/recovery with a deterministic reason; no unrestricted iframe fallback |

Tab presets are producer UI, not a fourth durable target family. Their output is
classified by the target it requests. Space types change navigation metadata and
do not construct Panel content.

## Versioned durable schema

Version 1 is an exact, unknown-field-rejecting discriminated union:

```ts
type PanelTarget =
  | { version: 1; kind: 'workspace-surface'; workspaceId: string; surfaceKey: string }
  | { version: 1; kind: 'plugin-surface'; craftId: string; pluginId: string; surfaceKey: string }
  | { version: 1; kind: 'custom-url'; requestedUrl: string };
```

The stored value contains lookup inputs, not effective runtime authority. In
particular, it contains no renderer key, expanded workspace path, resolved URL,
provenance, sandbox policy, privilege, equivalence key, or backend-sharing key.
A custom URL is only a requested locator and must pass the current trusted URL
resolver on every resolution.

## Trusted resolution boundary

Resolution joins the parsed target with current trusted Workspace metadata,
built-in definitions, the current Craft-to-Workspace relation, and installed
plugin/factory manifests. Only that join can produce:

- renderer key and runtime payload;
- effective provenance and capabilities;
- stable equivalence key;
- backend-sharing key; and
- Split View compatibility/runtime classification.

Missing Workspaces, removed plugins or contributions, unsupported schema
versions, malformed identifiers, unknown fields, unsafe URL schemes, and unknown
surfaces fail closed. Persisted or legacy URLs cannot redirect a built-in or
factory target, and persisted provenance cannot self-upgrade privileges.

Renderer keys are stable registry data (`vk-agent-iframe`, `code-iframe`,
`forms-iframe`, `beads-iframe`, `plugin-iframe:<plugin>/<surface>`, and
`plugin-react:<plugin>/<surface>`), not values accepted from storage.

## Identity and sharing

- Workspace-surface equivalence is Workspace identity + registered surface key.
- Plugin-surface equivalence is Craft identity + installed plugin/surface key.
- Custom-URL equivalence uses the trusted resolver's canonical URL.
- Backend-sharing keys are independently derived by each trusted definition;
  they do not imply shared iframe or renderer state.

This permits separate Panels to share backend identity without sharing live view
state.

## Split View capability

Definitions declare one of:

1. `leaseable-runtime` — the existing runtime has a proven stable host contract;
2. `recreatable-transient-runtime` — Split View creates a transient runtime and
   exposes an explicit continuity statement; or
3. `unsupported` — the picker returns a deterministic reason.

Compatibility is based on definition-provided compatibility keys, not target
kind conditionals. Matching candidates from the invoking Craft sort first, while
compatible cross-Craft candidates remain permitted. Unsupported candidates do
not silently become iframe targets.

## Migration classifications

The executable table covers generated built-ins, custom/preset URLs, plugin
iframe and React surfaces, workspace-factory output, pairs, homepage state,
temporary Create Workspace UI, and removed plugins/factories. Migration uses the
consistent joined source snapshot required by the implementation plan; the
contract deliberately quarantines when trusted identity cannot be reconstructed.
This per-representation classification runs only after the migration admits a
VK-backed Craft; the separately approved migration rule skips other non-VK
Crafts rather than preserving their Views as Panels.

## GO decision and limits

**GO:** the versioned shape is sufficient to implement the normalized registry
without making stored URLs, paths, renderer names, or provenance authoritative.
The tests demonstrate deterministic parsing, resolution, identity, sharing,
migration, missing-target, and generic Split compatibility behavior.

This spike is not the production registry, migration, iframe policy, plugin
installer, or Dockview integration. M2.3 must build its definitions from the
actual current registry and resolver services, retain exact schema parsing, and
add definitions atomically when new producers become constructible.
