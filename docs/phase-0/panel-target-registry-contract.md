# Phase 0 Panel target registry contract

Status: **GO** for implementing the production registry in M2.3.

Executable evidence lives in `spikes/dockview-contract/targetRegistry.ts` and
`targetRegistry.test.ts` and runs in the full Dockview contract command.

## Audited producer inventory

The audit follows `types.ts`, `AddTabModal`, `WorkspaceShell`, the plugin
registry, `craft-surfaces`, `react-craft-surfaces`, `workspace-composition`, and
`IframePanel`. The executable inventory locks these current producer families:

| Producer | Durable/migration outcome |
| --- | --- |
| VK Agent | `workspace-surface(workspaceId, builtin/agent)` |
| Code | `workspace-surface(workspaceId, builtin/code)`; current container reference is resolved, never stored path authority |
| Beads | `workspace-surface(workspaceId, builtin/beads)` |
| Forms | `workspace-surface(workspaceId, builtin/forms)` |
| Manual URL or URL-prompt preset | `custom-url(requestedUrl)` interpreted only by the current custom-URL definition |
| Manifest `craftSurfaces` iframe | `plugin-surface(pluginId, surfaceKey)` reconstructed from the installed contribution |
| First-party plugin React surface | The same `plugin-surface` identity with an explicit recreatable-runtime continuity contract |
| Manifest `internalRoutes` | Parse the persisted `internal://plugins/<plugin>/<path>` View URL, then create distinct `plugin-internal-route(pluginId, routeKey, params)` identity through contribution/path matching and parameter allowlisting |
| Workspace factory | Installed factory/tab identity maps to canonical registered targets; expanded URL is ignored |
| Built-in or user pair | Read production `ViewPair.tabIds` against the enclosing Craft Views; topology is emitted only when two distinct referenced Views and both targets resolve |
| `tg_home`, `tab_overview`, or `internal://spaces-overview` | `skip/homepage-representation`; no Panel and no normalized homepage state |
| Create Workspace action | `skip/temporary-create-workspace` |
| Legacy runtime-only craft-surface placeholder | Always `skip/ephemeral-plugin-placeholder`; legacy metadata and URL never create a target |

Unknown internal URLs, missing contributions, removed plugins/factories, and
unresolvable members produce typed diagnostics without an iframe fallback.
Space-type contributions affect navigation metadata and are not Panel producers.

## Versioned stored schema

Version 1 is an exact-key, unknown-field-rejecting union:

```ts
type PanelTarget =
  | { version: 1; kind: 'workspace-surface'; workspaceId: string; surfaceKey: string }
  | { version: 1; kind: 'plugin-surface'; pluginId: string; surfaceKey: string }
  | {
      version: 1;
      kind: 'plugin-internal-route';
      pluginId: string;
      routeKey: string;
      params: Record<string, string>;
    }
  | { version: 1; kind: 'custom-url'; requestedUrl: string };
```

The owning Panel supplies authoritative Craft context to resolution. A Workspace
target deliberately does not duplicate `craftId`. Stored targets contain no
renderer key, expanded Workspace path, effective URL, provenance, capability,
runtime class, Split compatibility, equivalence key, or sharing key.

## Single trusted resolution boundary

Every target kind invokes a current trusted definition. The definition returns a
complete result which the boundary validates before use:

- stable renderer key and runtime payload;
- effective provenance;
- concrete sandbox, clipboard-read/write, same-origin, and navigation policy;
- leaseable, recreatable-with-continuity, or unsupported runtime classification;
- Split compatibility inputs;
- equivalence inputs; and
- backend-sharing inputs.

The boundary requires that the owner Craft exists, still maps to the target's
current Workspace, permits the target scope, and references an available
Workspace. All definition exceptions and malformed results become typed recovery
instead of escaping. Policy tightening is effective immediately because nothing
authoritative is read from the stored target.

Custom URLs have no kind-based runtime or Split defaults. Their definition may
allow leasing, require transient recreation, or deny Split View. The requested
URL is untrusted input; malformed and disallowed schemes fail closed.

`internalRoutes` have a separate contribution table and identity from
`craftSurfaces`. Migration begins with the real persisted View URL and applies
the same `internal://plugins/` plugin-ID decoding, leading-slash normalization,
backslash rejection, and `..` segment rejection as the current runtime parser.
It matches exactly one installed contribution by plugin ID and normalized path,
then stores only the stable route key and validated, non-duplicate allowlisted
parameters. Malformed, ambiguous, removed, and unmatched routes are quarantined
and never retried as custom URLs.

## Identity, sharing, and Split View

Definitions—not target-kind branches—supply equivalence and backend-sharing
inputs. Separate Panels may share backend identity without sharing live renderer
state. Split compatibility uses definition-provided compatibility values, sorts
compatible same-Craft candidates first, and continues to permit compatible
cross-Craft choices. Unsupported runtimes retain a deterministic reason.

## Migration evidence

Legacy classification receives enclosing group, View, owning Craft, and joined
Workspace/plugin context:

- runtime-only ephemeral placeholders are skipped even if their legacy metadata
  or URL appears valid; a separate test reconstructs the surface from the current
  installed definition;
- all three homepage identifiers are recognized independently;
- homepage-only Voyages are omitted, while mixed Voyages retain their valid
  content with balanced per-outcome counts;
- factory expanded URLs are ignored;
- pairs consume the production `ViewPair.tabIds` and enclosing Craft View
  collection. Exactly two distinct ordered IDs are required. Invalid cardinality
  has the pair-level reason `pair-cardinality`, including for an empty ID list;
  member diagnostics exist only for the IDs actually supplied and remain ordered.
  Missing, malformed, skipped, and unresolvable members retain per-ID diagnostics;
  placement topology exists only when both source Views and both targets resolve;
  and
- the migration contract runs only after the approved outer migration admits a
  VK-backed Craft. Non-VK Crafts remain skipped by that outer rule.

## GO decision and limits

**GO:** the corrected contract proves strict schema parsing, authoritative owner
validation, unified fail-closed resolution, current-policy derivation,
production-shaped internal-route and pair migration, ephemeral/homepage omission,
pair diagnostics, stable identity, backend sharing, and generic Split capability
selection.

This is an isolated Phase 0 contract, not production integration. M2.3 must build
definitions from the real Workspace and installed-plugin services, preserve the
same typed recovery behavior, and require inventory/test updates whenever a new
producer becomes constructible.
