# Dockview Voyage Workbench Implementation Plan

## Status

**Corrected plan proposed for final review.** This document incorporates the
completed product forms, the VD and VK repository audit, the prior SubVoyage
prototype review, and the Herdr source review. It replaces the older clean-break
proposal.

Product decisions are complete. Production implementation remains blocked until
this corrected plan passes the M0 architecture review. Implementation must not
begin with a wholesale UI rewrite. The first deliverable
is a set of executable contract tests and technical spikes proving the risky
Dockview, iframe, persistence, and migration assumptions.

## Product Model

### Vocabulary

- A **Voyage** is a resumable mission/work session. It can span multiple projects,
  may initially be named with a date, and may have no mission text yet.
- A **Craft** is an existing VK Workspace: one task/workspace backed by one or
  more repositories.
- A **Voyage membership** associates one Craft with one Voyage. Membership is
  many-to-many; the same Craft may belong to several Voyages, but appears only
  once as a membership inside any one Voyage.
- A **Panel** is one independently placeable Dockview tab instance. One Craft
  membership may have multiple Panels, including repeated Panels for the same
  view type.
- A **Panel target** is the typed application object or destination displayed by
  a Panel. There is no universal `Resource` table in the first schema.
- A **Dockview group** is visual layout only. It is not a Craft, task, Voyage, or
  durable domain hierarchy.

### Authority boundaries

Dockview is the sole authority for:

- groups, splits, dimensions, and tab ordering;
- active Panel and active group;
- maximized state and other supported Dockview presentation metadata.

VD domain state is authoritative for:

- Voyages, optional missions, ordering, and lifecycle;
- Voyage-to-Craft membership;
- Panel identity, typed target, title policy, and close policy;
- external VK identifiers and target configuration;
- layout revisions, persisted history, recovery state, and audit timestamps;
- persisted target claims and the versions used to interpret them. Effective
  iframe provenance and capabilities are never trusted from persisted data; they
  are derived by the installed target registry at resolution time.

Runtime registries are authoritative for mounted components, retained iframe DOM
instances, subscriptions, and other non-serializable live state.

The legacy `TabGroup`/`Craft`, `TabPair`, `tileMode`, `tiledTabs`, pair ratios,
and per-group active maps must not survive as a second writable layout model.

## Confirmed Product Decisions

1. Voyages remain first-class domain objects and are progressively structured.
   Creation offers an optional name and mission, but neither requires ceremony.
2. A Voyage may contain Crafts from multiple projects/repositories.
3. Voyage-to-Craft membership is explicit and many-to-many.
4. Removing a Craft from a Voyage removes its membership and Voyage-owned
   Panels, but never deletes the VK Workspace, sessions, repositories, or agents.
5. Creating a focused Voyage lets the user select Crafts from another Voyage and
   starts with a clean generated layout.
6. One membership may own multiple independent Panel instances.
7. Panels use typed discriminated targets rather than a generic resource table.
8. Cross-Voyage reuse shares an explicitly selected backend target by default,
   while each Panel owns independent frontend presentation state.
9. Voyage overview and mission information live in the collapsible sidebar. The
   Dockview area is an adaptive cross-Craft workbench.
10. Desktop uses Dockview Core. Mobile v1 uses a single-Panel presentation and
    does not expose touch Dockview editing.
11. Floating groups, browser popouts, and touch layout editing are not v1
    requirements. Persisted application-owned layout history is required.
12. SubVoyages and nested layout semantics are deferred until the core model is
    stable.
13. Voyages, layouts, history, recovery records, and related settings are shared
    installation-wide for the current product. No user owner or speculative
    tenant tables are introduced.
14. Migration is one-way. The new model never dual-writes legacy state, never
    reverse-exports to it, and never uses retained raw input for rollback.
15. An Agent Panel offers **Open beside** and **Open maximized** Code actions.
    Within the same Voyage, they prefer a visibly adjacent equivalent and
    otherwise reuse the most recently active equivalent Code Panel, creating one
    only when absent. Duplication is a separate explicit command.
16. An Agent Panel also offers **Split View**: a temporary foreground Dockview
    controller with a fixed, resizable Agent + Code split. Split View is not a
    Voyage, owns no durable layout, and never mutates or restores the underlying
    Voyage layout.

## Scope and Success Criteria

The first release is feature complete when:

1. Users can create, rename, resume, archive, and remove Voyages and can add,
   copy, move, reorder, and remove Craft memberships without affecting VK data.
2. Users can open all supported Craft and Voyage-wide targets as Panels, create
   grids of tab groups, move/reorder/resize Panels, and restore the result.
3. The same Craft can have multiple Panels and repeated view types without
   duplicate membership records.
4. Supported Dockview mutations preserve live iframe identity and drafted state
   while the iframe remains inside the configured retention budget.
5. Two Voyages can switch seamlessly with defaults of two warm Voyage
   controllers and one global maximum of five iframe instances across them;
   both limits are configurable and visible work is never evicted.
6. Domain mutations, Panel definitions, layout snapshots, and history entries
   that form one operation commit in one SQLite transaction.
7. VK-backed Crafts and recoverable Voyage membership migrate from a consistent
   joined snapshot of the legacy `workspace` and `workspace-sessions` states.
   Every source item is balanced as migrated, intentionally skipped, or rejected
   with an ID and reason.
8. Malformed layouts are quarantined, a safe layout is shown, and the replacement
   is saved only after validation or a user mutation.
9. Canonical query routes restore a Voyage and optionally focus a Craft or Panel;
   supported old links resolve or redirect without creating duplicate Panels.
10. Desktop keyboard and screen-reader workflows have non-drag alternatives.
    Mobile can navigate the same Voyage and open one Panel at a time.
11. The sidebar rolls up pending agent input, running agents, and waiting forms
    and navigates directly to their source.
12. Iframe capability grants derive from audited target provenance, not hostname
    similarity alone.
13. Agent-to-Code actions are deterministic, idempotent, accessible, persist as
    ordinary mutations, and preserve the reused iframe across supported moves
    and maximize/restore operations.

## Durable Data Model

### SQLite ownership

Extend VD's existing Prisma schema, generated Kysely types, schema-migration
pipeline, and configured `vd.sqlite`; do not create a second application database.
All Voyage records and settings are installation-global. VK Workspace, session,
process, repository, and preview IDs are external logical references validated
through VK APIs. Do not add cross-database foreign keys or make VD depend on VK's
physical database layout.

Suggested tables (exact naming may follow the repository's Prisma conventions):

```text
voyages
  id, schema_version, revision, activation_sequence,
  history_cursor_sequence NULL,
  name, mission, lifecycle_state,
  created_at, updated_at, last_opened_at

voyage_crafts
  voyage_id, craft_workspace_id, sort_key, created_at, updated_at
  PRIMARY KEY (voyage_id, craft_workspace_id)

voyage_panels
  id, voyage_id, craft_workspace_id NULL,
  target_kind, target_version, target_payload_json,
  title_mode, custom_title NULL, close_policy, last_activated_sequence NULL,
  created_at, updated_at

voyage_layouts
  voyage_id, format_version, dockview_version,
  aggregate_revision, snapshot_json, snapshot_hash, updated_at

voyage_history
  id, voyage_id, sequence, aggregate_revision,
  panels_json, snapshot_json, created_at

voyage_layout_quarantine
  id, voyage_id, source_revision, reason_code,
  rejected_snapshot_json, created_at, resolved_at NULL

voyage_settings
  singleton_key CHECK (singleton_key = 'installation'),
  warm_voyage_limit, iframe_runtime_limit, history_limit, updated_at
```

`voyage_crafts.craft_workspace_id` is deliberately not a database foreign key.
The application should report missing VK Workspaces as stale external references
and offer removal or relinking rather than failing SQLite integrity checks.

All VD-owned child rows use real foreign keys to `voyages` with explicit deletion
behavior. `voyage_crafts` is unique on `(voyage_id, craft_workspace_id)`.
Craft-bound Panels must reference a membership in the same Voyage, enforced by a
composite foreign key when Prisma/SQLite generation supports it and otherwise by
a transaction invariant plus database trigger. Layout and settings singleton
constraints, non-negative revisions/sequences, and unique per-Voyage history
sequences are database-enforced. The existing `Migration` table remains the only
migration ledger; do not introduce a parallel `migration_ledger` table.

`voyages.activation_sequence` is the monotonic source for durable Panel recency.
`voyage_panels.last_activated_sequence` is nullable and, when present, cannot
exceed its Voyage's counter. It is presentation metadata inside the same Voyage
aggregate, not a timestamp and not a second layout model. History never owns,
restores, resets, or decrements either value: the Voyage counter only advances,
including across undo and redo.

### Typed Panel targets

Persist a validated discriminated union. Initial variants should be based on
actual current surfaces, not speculative abstractions:

```ts
type PanelTarget =
  | { kind: 'craft-overview'; workspaceId: string }
  | { kind: 'agent-session'; workspaceId: string; sessionId: string }
  | {
      kind: 'code';
      workspaceId: string;
      repoId?: string;
      folderIntent?: 'workspace-root' | 'repository';
    }
  | { kind: 'changes'; workspaceId: string; repoId?: string }
  | { kind: 'beads'; workspaceId: string }
  | { kind: 'forms'; workspaceId: string; formId?: string }
  | { kind: 'terminal'; workspaceId: string; terminalId: string }
  | { kind: 'preview'; workspaceId: string; previewId: string }
  | { kind: 'internal-route'; routeId: string; params: JsonObject }
  | { kind: 'custom-url'; url: string }
  | { kind: 'plugin-surface'; pluginId: string; surfaceId: string; params: JsonObject };
```

The persisted Dockview Panel ID equals `voyage_panels.id`. Dockview params contain
only a version and stable Panel lookup ID. URLs, credentials, permissions, and VK
objects must not be copied into the opaque Dockview snapshot.

Persisted paths, container references, expanded URLs, provenance labels, and
capability classes are never authoritative. In particular, a Code target's stable
identity is its `workspaceId` plus explicit repository/folder intent. The trusted
resolver obtains the current workspace directory, container reference, endpoint,
canonical URL, and iframe policy from VK and installed application configuration.
A last-observed legacy path may appear only in migration diagnostics.

### Versioned target registry

Phase 0 must inventory every target created by current built-ins, workspace
factories, URL presets, `ViewPair` expansion, registered plugins, iframe routes,
React Craft surfaces, and ephemeral placeholders. That inventory becomes the
versioned registry used by creation, migration, restoration, routing, and render
dispatch:

```ts
interface PanelTargetDefinition<TPersisted, TResolved> {
  kind: string;
  version: number;
  parse(value: unknown): TPersisted;
  migrate(value: unknown, fromVersion: number): TPersisted;
  resolve(value: TPersisted, context: TrustedResolverContext): TResolved;
  rendererKey: StableRendererKey;
}

interface ResolvedPanelTarget {
  canonicalLocation: string;
  effectiveProvenance: EffectiveProvenance;
  capabilityClass: CapabilityClass;
  resolverVersion: number;
}
```

Persist each target's kind and version. Unknown kinds, invalid payloads, missing
plugins, and denied capabilities resolve to typed recovery states; they must never
fall back to an unrestricted generic iframe. Resolver output is trusted only when
produced by the current registry and is not written back as an authorization
claim.

### Sharing semantics

- Agent sessions, terminals, and previews may share their explicit VK/backend
  identity across Panels and Voyages.
- Code, Changes, Beads, Forms, and internal routes share backing data but keep
  independent navigation and component state.
- Custom URLs receive separate iframe instances. Synchronization of page-local
  drafts is not promised unless that application supplies its own shared backend.
- Plugin surfaces are independent unless the plugin contract explicitly declares
  a stable shareable backend target.
- A distinct “start new” command creates a new agent/session/terminal where the
  target supports it; ordinary “open in another Voyage” must not duplicate work.

## Persistence and History Contract

### Aggregate revision and transaction boundary

`voyages.revision` is the compare-and-swap revision for the complete mutable
Voyage aggregate: Voyage metadata, memberships, Panels, current layout, and the
history cursor. There is no independent layout revision that could advance out of
step. Every write supplies `expectedRevision`, validates the complete resulting
aggregate, writes all changed rows and the new opaque snapshot, updates history
when applicable, increments the aggregate revision exactly once, and commits in
one `vd.sqlite` transaction.

Stale revisions return a typed conflict and never overwrite the winner. Layout
JSON is never structurally merged. Multi-client collaborative editing is out of
scope.

An operation that moves membership between Voyages acquires their in-process
coordinators in stable Voyage-ID order, checks both expected revisions, and
updates both aggregates in one database transaction. Both revisions advance or
neither does. Add/copy operations change only the destination aggregate.

### Per-Voyage serialized mutation coordinator

Each live Voyage has exactly one coordinator containing its accepted revision,
accepted aggregate/snapshot, optimistic aggregate/snapshot, command queue,
gesture boundary, dirty state, save timer, and history cursor. React components,
Dockview callbacks, routing, and sidebar actions never write persistence directly.

Application commands follow one sequence:

1. enqueue and deduplicate by command identity where repeat activation is unsafe;
2. capture the accepted before-state;
3. apply the domain and Dockview mutation in memory;
4. capture and validate the complete after-state;
5. persist it through aggregate CAS in one transaction;
6. publish the accepted revision only after commit;
7. on validation/save failure, restore the before-state without creating history.

On a CAS conflict the coordinator loads and validates the winning aggregate. It
may replay only a known deterministic command whose preconditions still hold;
otherwise it restores the winner and asks the user to retry. It never merges
Dockview JSON, replays raw callbacks, or continues autosaving a rejected state.

Dockview-native drag and resize gestures use explicit before/after mutation
boundaries. Record one before-state at gesture start, allow intermediate
`onDidLayoutChange` events to update only the pending snapshot, and record one
validated after-state at gesture completion/cancellation. A complete gesture
creates at most one history checkpoint. Debounce noisy snapshot persistence at an
initial 300 ms without allowing a later timer to overtake a structural command.

Hash canonical serialized snapshots and skip unchanged writes. Flush through the
same queue before switching Voyages, controller eviction, page teardown, or
repository shutdown where the platform permits it. `beforeunload` is a best-effort
last flush, never the sole durability mechanism.

### Durable activation order

A meaningful user activation—such as selecting a tab by pointer or keyboard,
opening/focusing a Panel through a user command, or focusing a visible Panel—sets
that Panel's `last_activated_sequence` to the next Voyage-monotonic activation
sequence. The update runs through the same per-Voyage coordinator and persists
atomically. It advances the aggregate CAS revision but does not create a layout-
history checkpoint.

The event bridge must distinguish user activation from Dockview restoration,
`fromJSON()`, safe-layout construction, route reconciliation, and other synthetic
callbacks; restore-generated or programmatic focus must not manufacture recency.
When a user command programmatically focuses a Panel, the command
records exactly one activation and suppresses the resulting Dockview callback.
Coalesce duplicate focus/activation noise for the same Panel, and safely debounce
rapid focus transitions through the serialized queue without allowing an older
delayed event to overwrite the final user-active Panel or a newer aggregate
revision.

MRU selection is durable across reload and warm-controller eviction. Select the
greatest `last_activated_sequence`; a present value sorts above a missing value,
and equal or missing values resolve to the lexicographically smallest stable Panel
ID. Restoration reads this ordering but never updates it. The same selector is
the only implementation of “most-recent Panel” used by Open Code, Craft routing,
sidebar shortcuts, and any later focus command.

Initialize these fields deterministically. A new Voyage starts with
`activation_sequence = 0`; a newly created Panel remains null unless the creating
user command meaningfully activates it, in which case that same command assigns
the next sequence. The one-way migration traverses source Voyage entries, legacy
visited order, view order, and stable generated Panel IDs deterministically. It
assigns increasing sequences only where the legacy state supplies activation
evidence and assigns the valid legacy active selection last so it has the greatest
value; Panels without evidence remain null and use the stable-ID tie-break. Any
schema migration from normalized rows lacking this metadata applies the same
saved-active evidence rule exactly once. Ordinary snapshot restore never reseeds
or increments activation metadata.

### Undo and redo

Persist a bounded, configurable linear history, initially 50 checkpoints per
Voyage. Each checkpoint contains the Dockview snapshot and Voyage-owned Panel
definitions required to reverse open, close, move, maximize/restore, and
rearrange actions, plus a cursor identifying the accepted entry.

The history boundary is explicit. `voyage_history.panels_json` is a versioned
array of structural Panel projections, not serialized `voyage_panels` database
rows. Repository code constructs and validates each projection field by field:

```ts
type StructuralPanelHistoryRecord = {
  id: PanelId;
  craftWorkspaceId: WorkspaceId | null;
  targetKind: PanelTarget["kind"];
  targetVersion: number;
  targetPayload: JsonObject;
  titleMode: "automatic" | "custom";
  customTitle: string | null;
  closePolicy: ClosePolicy;
};
```

These are the only Panel fields required for open/close/move restoration. The
projection excludes `voyages.activation_sequence`,
`voyage_panels.last_activated_sequence`, timestamps, and all other activation,
focus, runtime, and incidental persistence metadata. Never spread or serialize a
whole database row into `panels_json`.

Undo moves the cursor backward and redo moves it forward through the coordinator.
A new mutation after undo deletes the abandoned redo branch in the same
transaction. Pruning removes the oldest entries beyond the configured bound while
retaining the current entry and nearest usable predecessors. Restore, initial load,
unchanged autosave, focus-only operations, and failed/cancelled gestures do not
create checkpoints.

Undo/redo advances the normal aggregate CAS revision but never decrements,
restores, or otherwise rewinds the Voyage activation counter. When applying a
historical checkpoint, merge structural fields by stable Panel ID with current
activation metadata: every surviving Panel retains its current
`last_activated_sequence`. A Panel structurally recreated by undo or redo starts
with null recency even if an older checkpoint predates its deletion. Dockview
restore callbacks remain suppressed and cannot activate the recreated Panel. Only
a later meaningful user activation assigns the next Voyage-monotonic sequence
through the normal serialized coordinator, as a focus-metadata write outside
layout history. Open Code and every other MRU consumer therefore select from the
current recency values after undo/redo, never from checkpoint-time focus state.

History explicitly excludes:

- Voyage mission/name changes;
- Craft membership changes;
- VK Workspace, repository, session, process, or agent mutations;
- iframe document state.

Craft removal therefore uses a separate confirmation and short-lived “Undo
removal” command, not the layout history stack. Add, move, or remove membership
commands do not create a partial layout-history checkpoint that could restore
Panels without their membership; their dedicated undo restores the complete
affected aggregate or aggregates atomically.

### Malformed layout recovery

1. Parse and schema-check domain rows, target versions, Dockview serialization
   version, and the complete snapshot before constructing live Panels or calling
   Dockview `fromJSON()`.
2. Verify unique Panel IDs, registered renderer keys, target payloads, Voyage
   ownership, and membership references.
3. Reject snapshots containing floating/popout state, unknown component keys,
   unsupported pinned-tab serialization, or any v1-disabled layout construct.
   On failure, insert the untouched snapshot and reason into quarantine.
4. Build a deterministic safe layout from valid Panels or valid memberships.
5. Show a recovery notice with retry, inspect diagnostics, reset, and restore
   previous-history options.
6. Call `fromJSON()` only with the validated original or generated safe snapshot.
   Do not overwrite the rejected durable snapshot merely because fallback UI
   rendered. Commit a replacement only after an explicit recovery action or a
   valid subsequent workbench mutation.

## Migration Contract

Migration is a one-way startup data migration. There is no legacy rollback before
or after cutover, no reverse exporter, no shadow authority, and no dual write.
Retained raw input exists only for bounded audit and diagnostics and must never be
used to resume legacy writes.

Implement migration as a timestamped TypeScript entry in a SongDrive-style
`data_migrations` registry, separate from schema migrations but recorded in the
existing VD `Migration` ledger. Startup order is mandatory:

1. open configured database paths and run the normal `vd.sqlite` schema migrations;
2. before Springboard or any other legacy/new-model writer starts, begin one read
   transaction against the configured `kv.db`;
3. read both exact keys, `engine|module|workspace|state.persistent|workspace` and
   `engine|module|workspace|state.persistent|workspace-sessions`, in that same
   transaction so they form one consistent joined snapshot;
4. snapshot the installed plugin/factory/surface registry used to classify legacy
   targets, without treating ephemeral generated surfaces as persisted input;
5. parse legacy session arrays, `{ sessions: [...] }`, v2 envelopes, and v3
   envelopes together with the referenced `WorkspaceState`;
6. construct and validate the complete normalized result in memory;
7. in one `vd.sqlite` transaction, insert normalized rows, diagnostics/audit data,
   and the existing `Migration` ledger record;
8. commit only if all counts, references, constraints, and snapshots validate.

If no legacy `kv.db` exists, or both keys are absent on a demonstrably fresh
installation, initialize an empty normalized store and record that outcome. If
only one expected key is missing from an existing legacy installation, either
source read is inconsistent/unavailable, a source shape is invalid, a write is
partial, or validation fails, roll back the `vd.sqlite` transaction and fail
startup with actionable diagnostics. A ledger entry makes reruns idempotent; an
existing successful entry prevents duplicate rows. Do not start application
writers in a partially migrated state.

Classification rules:

1. Migrate only Crafts with a resolvable VK Workspace identity and preserve their
   Voyage membership, order, titles, and valid selected views.
2. Coalesce duplicate occurrences of one VK Craft in one Voyage into one
   membership. Convert every valid occurrence/view selection into separate Panel
   definitions so coalescing does not lose repeated views.
3. Expand a legacy `ViewPair` into its valid constituent Panels and a deterministic
   initial 50/50 Dockview split where both targets resolve. Report missing pair
   members individually; never preserve the pair as a second layout model.
4. Recognize temporary Create Workspace/action surfaces and skip them.
5. Treat the exact legacy homepage representations `tg_home`, `tab_overview`, and
   `internal://spaces-overview` only as migration classifications and route-level
   compatibility. They never create a normalized Voyage, membership, Panel,
   layout, singleton homepage-selection, or any other normalized row.
6. Skip a source Voyage containing only homepage representation, including its
   Voyage occurrence, with reason `homepage-representation`. In a mixed Voyage,
   skip and count each Overview occurrence with that same reason while migrating
   its valid VK Craft content normally.
7. Skip/delete all other non-VK Crafts and their views as approved. Do not create
   fake memberships, generic Voyage Panels, or a permanent legacy Craft type.
8. Do not migrate runtime-only ephemeral plugin surface placeholders. Installed
   plugin surfaces are reconstructed later from the current manifest/registry.
9. Treat unresolved VK Craft IDs, view IDs, target versions, and pair members as
   rejected migration items; fail migration when loss violates the explicit
   classification/count contract rather than silently dropping them.
10. Seed `activation_sequence` and `last_activated_sequence` deterministically
    from legacy visited/active evidence in stable source occurrence/view order,
    assigning the valid legacy active target the greatest sequence. Panels with no
    activation evidence remain null and use the stable-ID tie-break. Restoration
    never reseeds or advances recency.

For every source Voyage, Craft occurrence, view selection, pair member, and known
special surface—including every Overview occurrence—diagnostics must balance
exactly:

```text
source count = migrated count + intentionally skipped count + rejected count
```

Record stable source IDs and reason codes for skipped/rejected records. Migration
success requires balanced totals and zero unclassified items. The untouched joined
source envelope may be copied to an access-controlled, timestamped diagnostic
artifact, subject to retention and sensitive-data rules, but is not a backup or
rollback mechanism.

The prior SubVoyage work contributes stable selected-view references, Craft
provenance labels, stale-reference repair, explicit focus routing, iframe identity
lessons, and regression tests. Its cell/tile topology, responsive CSS grid,
`TabPair` ratios, and parallel active-item maps are superseded by Dockview.

## Runtime Architecture

Suggested boundaries:

```text
src/voyages/domain/*                 pure types, invariants, commands, selectors
src/voyages/persistence/*.node.ts    SQLite repository and migrations
src/store/db/data_migrations/*       timestamped startup data migrations
src/voyages/migration/*              joined-state parsing/classification helpers
src/voyages/history/*                checkpoint and undo/redo policy
src/voyages/recovery/*               validation and quarantine workflow
src/dockview/DockviewWorkbench.tsx   lifecycle and event bridge
src/dockview/adapter.ts              typed Dockview command boundary
src/dockview/defaultLayout.ts        adaptive deterministic layout
src/dockview/panelRegistry.ts        stable renderer registry
src/dockview/panels/*                typed target renderers
src/iframes/runtimeRegistry.ts        acquire/attach/detach/evict/dispose
src/iframes/trustPolicy.ts            provenance-to-capability mapping
src/attention/*                       VK/form adapters and roll-up selectors
src/components/VoyageSidebar/*        overview, browser, attention, drag/drop
```

React components must not independently update both Dockview and SQLite. All
layout-changing UI actions pass through a command coordinator that can restore
the pre-command in-memory snapshot if durable commit fails.

### Iframe lifecycle

- Use Dockview `renderer: 'always'` for iframe-backed Panels.
- Key runtime entries by Panel ID, not URL.
- Preserve the existing imperative/module-level retention approach until tests
  prove a simpler renderer lifecycle safe.
- Provide explicit acquire, attach, detach, navigate, reload, evict, and dispose
  operations with idempotent cleanup.
- Model temporary presentation through exclusive runtime attachment leases. A
  runtime has exactly one attachment host at a time. Split View may transfer an
  existing Agent or Code runtime between application-owned renderer hosts, but
  must not clone it or manipulate Dockview's private DOM.
- Add a parent-document pointer shield during drag/resize and restore pointer
  behavior on drop, cancellation, blur, error, and teardown.
- Maintain one browser-runtime iframe registry and one installation-configured
  maximum total iframe budget across all warm Voyages; the warm-Voyage limit
  never multiplies it.
- Count every iframe. A frame is active only while its Panel is visible in the
  foreground Voyage. Hidden tabs and every frame in a background Voyage are
  inactive, including background frames whose Panels are application-pinned.
- Never evict a visible Panel. Whenever total iframe count exceeds the global
  limit, evict inactive runtimes by global LRU until within the limit or only
  visible frames remain. Disclose that returning to an evicted iframe reloads its
  page-local state.
- Legacy/application `pinned` means non-closeable; it is not a runtime-retention
  exemption and must not be confused with Dockview Enterprise pinned-tab state.
- If visible iframe count alone exceeds the configured budget, permit and expose
  the temporary over-budget condition rather than destroying visible work. Do not
  retain additional inactive frames until the total returns within budget.
- Keep the active and most-recent Voyage controller warm by default. Controller
  eviction flushes persistence and tears down subscriptions exactly once; its
  iframe entries remain subject to the same global LRU.
- Pin the invoking Voyage controller while Split View holds runtime attachment
  leases. Release attachment leases before releasing that pin on every exit,
  error, route change, and component teardown path.

## Default Desktop and Mobile Experience

### Desktop

- The sidebar is collapsible and contains a global Attention section followed by
  the Voyage tree.
- The active Voyage expands to show its optional mission, Crafts, and stable view
  shortcuts. Selecting a shortcut focuses an existing matching Panel or opens a
  new one according to command intent.
- New Voyages receive an adaptive work area: useful Panels for one or two selected
  Crafts are visible, with overflow views added as tabs rather than tiny groups.
- Craft identity appears in Panel metadata/title treatment using Tabler icons and
  accessible text. Color may supplement identity but cannot be the sole cue.
- Dragging a Craft onto another Voyage adds membership by default. An explicit
  Move action atomically adds the destination membership and its default Panels
  without resetting the destination layout, then removes source membership and
  Panels. Reordering within one Voyage only changes `sort_key`.

### Agent Panel Open Code workflow

Agent Panels expose a compact split button/menu:

- primary: **Open beside**;
- secondary: **Open maximized**;
- optional elsewhere: **Open/focus Code**;
- explicit separate command: **Duplicate Code Panel**.

All variants resolve the invoking Agent Panel's VK Workspace, then resolve the
canonical Code target through the versioned trusted registry. Equivalent means
the same Code target kind, `workspaceId`, and explicit repository/folder intent;
expanded URLs and last-known paths do not participate. Lookup is limited to the
current Voyage—never move a Panel out of another Voyage.

Selection order is exact:

1. Find equivalent Code Panels only in the invoking Voyage.
2. Restrict to equivalents already visible in a Dockview group immediately
   adjacent to the invoking Agent Panel's group. If any exist, choose the greatest
   durable `last_activated_sequence`, with the shared stable-ID tie-break.
3. Only when none is visibly adjacent, choose the greatest durable
   `last_activated_sequence` among all equivalent Panels in that Voyage, using the
   same tie-break.
4. Create a Code Panel only when no equivalent exists.

**Open beside** is idempotent. Activate/focus an adjacent selection without a
layout mutation or relocating a newer non-adjacent equivalent. Otherwise reuse
and move the selected MRU Panel immediately to the Agent's right; create one only
when absent. Use a 50/50 split when both Panels meet tested minimum widths. Below
that breakpoint, activate the Code Panel and maximize its group rather than create
an unusable split. Moving a sole-tab Panel may collapse its former group;
relocation, group cleanup, sizing, focus, and its one activation update are one
coordinator command and one layout-history checkpoint. The activation metadata
persists in that aggregate write but is excluded from the checkpoint and does not
create a second checkpoint.
Deduplicate repeated invocation while that command is pending.

**Open maximized** resolves/reuses or creates the same Panel without relocating an
existing one, activates its tab/group, and uses Dockview group maximize. “Full
screen” never invokes the browser Fullscreen API. A visible **Restore layout**
action and normal maximize/restore affordance return to the underlying topology.
Creation plus maximize is one serialized command and one history checkpoint.

The split button, menu, and Restore action are keyboard-operable; accessible names
include the Craft when context is ambiguous. Announce the resulting layout change
and move focus only after the Code Panel is attached successfully. No Open Code
workflow depends on drag-and-drop.

### Temporary foreground Split View

**Split View** is a third Agent action, distinct from **Open beside** and **Open
maximized**. It fills the VD workbench viewport with a transient Dockview Core
controller containing exactly two non-closeable runtime-host Panels: Agent and
Code. Dockview owns this temporary controller's live split geometry and resize
sash. The initial ratio is 50/50 when both minimum widths fit; constrained widths
show one surface at a time with an Agent/Code switcher. Optional maximize/restore
may operate inside the transient controller. Arbitrary docking, moving, tabs,
floating, popouts, adding Panels, and persistence are disabled.

Split View is not a temporary Voyage and is not another durable layout authority.
Its geometry is session-only. Entry, resizing, surface switching, maximizing,
and exit do not invoke the Voyage mutation coordinator, write `layout_json`,
advance the Voyage layout revision, create `voyage_history`, or call `fromJSON`
against the underlying Voyage. Destroying the transient controller discards its
geometry; it never restores a saved "before" snapshot.

On entry, pin the invoking Voyage controller and acquire exclusive attachment
leases for the invoking Agent runtime and the selected same-Voyage equivalent
Code runtime. Attach them to stable renderer hosts owned by the transient
controller. If no equivalent Code Panel/runtime exists, create a collision-safe,
Split-session-only Code runtime from the trusted target resolver; create no
durable Panel row and dispose that runtime on exit. Existing runtime Panel IDs
remain unchanged. Underlying Voyage frames are application-inactive while the
two foreground surfaces are visible and protected by the same global iframe
budget.

Use `?voyage=<token>&split=<agent-panel-token>` as route intent, not serialized
layout. Entry pushes browser history. Browser Back and the visible **Back to
Voyage** action remove `split` idempotently and return to the canonical Voyage
route; the visible action must not depend on a prior history entry. Direct links
restore the Voyage and resolve targets before entering. Refresh reconstructs the
transient controller and does not promise pre-refresh iframe identity. Invalid or
stale links render recovery UI with Back to Voyage and never mutate the Voyage.

Implement entry/exit as `inactive -> entering -> active -> exiting -> inactive`
with a transition token or abort signal. Cleanup returns retained runtimes to
their original renderer hosts exactly once, disposes Split-only runtimes exactly
once, removes subscriptions/focus containment, destroys the transient controller,
releases leases, then releases the Voyage-controller pin. Partial attachment
failure rolls back through runtime-registry operations, never snapshot restore.
Focus enters Split View after both hosts attach and returns to the invoking Agent
control on exit. Essential controls are keyboard-operable; advanced keyboard
docking remains deliberately de-prioritized.

### Mobile v1

- Render the same Voyage/Craft hierarchy and attention information.
- Show one selected Panel at a time using normal application navigation.
- Preserve the same Panel IDs, targets, and deep links.
- Do not initialize an editable Dockview grid or expose drag-only operations.

## Attention Model

Herdr defines `Idle`, `Working`, `Blocked`, and `Unknown`, combines explicit agent
hooks with prioritized visible-terminal rules, stabilizes transitions, and rolls
up `Blocked > unseen Idle > Working > seen Idle > Unknown`.

VD should adopt the normalized roll-up idea, not terminal scraping. VK already
exposes `WorkspaceSummary.has_pending_approval`, `latest_process_status`, and
`latest_session_id`.

Initial typed signals:

```ts
type AttentionSignal =
  | { kind: 'agent-input-required'; workspaceId: string; sessionId?: string }
  | { kind: 'agent-running'; workspaceId: string; sessionId?: string }
  | { kind: 'form-response-required'; workspaceId: string; formId: string }
  | { kind: 'form-review-required'; workspaceId: string; formId: string };
```

Mapping and priority:

1. pending approval/question or waiting form requiring the user;
2. submitted form requiring agent review;
3. running agent;
4. no recognized signal.

Use “Needs attention” in the interface. Do not claim an agent is blocked when the
only evidence is that its process is running. Clicking a roll-up opens its Voyage,
Craft, and exact Panel/route. Deduplicate one underlying event shown through
multiple Voyages.

## Routing

Keep the current query-route family rather than introducing competing meanings
for `/workspaces/:workspaceId`.

Canonical state:

```text
/?voyage=<voyage-token>
/?voyage=<voyage-token>&craft=<craft-token>
/?voyage=<voyage-token>&panel=<panel-token>
```

Only one focal target is required. A Voyage snapshot already records every visible
Panel and its layout; URLs do not need multiple Panel parameters.

Resolution order:

1. load and validate the Voyage;
2. restore its saved layout;
3. if `panel` is valid, activate and focus it;
4. otherwise, if `craft` is valid, focus the most-recent Panel for that Craft or
   open its default Panel;
5. otherwise restore saved focus.

Preserve the current route contract:

- `/` remains the canonical dashboard and `/dashboard` remains a compatible
  entry point;
- existing `voyage`, `craft`, and comma-separated `views` query parameters,
  generated slugs, and collision-aware short ID tokens remain resolvable;
- stored `workspace-last-dashboard-url` values using `/` or `/dashboard` are
  normalized without losing supported focus intent;
- `/dashboard/workspaces/:workspaceId` remains the existing VD/VK Workspace
  opener used by generated links and plugins;
- unrelated query parameters, including referrer context, survive normalization.

Legacy `views` tokens resolve through the migration/target registry to migrated
Panels or deterministic open commands and then canonicalize to `panel` where
possible. Any incoming legacy URL that focuses `tg_home`, `tab_overview`, or
`internal://spaces-overview` canonicalizes to `/` with no Voyage, Craft, view, or
Panel focus and performs no layout/domain mutation. This compatibility redirect
does not write normalized homepage state or overwrite the browser-local
`workspace-last-dashboard-url` preference. Normal startup/navigation independently
chooses `/` or the last valid Voyage according to existing preference rules.

Invalid or ambiguous legacy tokens show a non-destructive recovery outcome and
must not mutate or autosave the Voyage layout. Compatibility fixtures cover
stored URLs and links emitted by current VD and installed first-party plugins.

## Iframe Security

Replace hostname-derived trust with provenance-derived capability classes:

- `vd-built-in`: VD-owned routes with the minimum required first-party grants;
- `vk-built-in`: known VK routes created by typed resolvers;
- `plugin`: grants declared by an installed plugin manifest and capped by VD;
- `forwarded-project`: dynamically port-forwarded project applications;
- `external-url`: user-entered or otherwise unclassified destinations.

Requirements:

1. The resolver, not the final hostname, assigns provenance.
2. Redirects cannot upgrade provenance or capabilities.
3. `sandbox` and `allow` attributes come from a tested capability matrix.
4. `allow-same-origin`, clipboard, downloads, popups, and navigation are granted
   individually and default off when not required.
5. Validate `postMessage` origin, source window, schema, and Panel identity.
6. Treat all snapshots and target payloads as untrusted serialized input.
7. Never persist credentials or bearer tokens in Panel targets or Dockview JSON.
8. Threat-model Caddy forwarding, `port-*` hosts, supervisor routes, plugin
   origins, redirect behavior, and compromised project dev servers before GA.

## Dockview Version and Disabled Features

Pin one exact tested `dockview-react` Core version in `package.json` and the lock
file. Store an application layout format version and the producing Dockview
version with every snapshot. Upgrades require serialization compatibility fixtures
and an explicit application migration or a fail-closed recovery path; do not rely
on a floating semver range for persisted JSON compatibility.

Floating groups and browser popouts are disabled in v1. Remove or intercept their
UI affordances and drop zones where Dockview permits, reject command/API attempts,
and quarantine imported snapshots containing floating/popout metadata before
`fromJSON()`. Tests must cover direct commands, drag targets, current
version snapshots, and older/future fixtures. Legacy `View.pinned` migrates only
to application close policy. Unsupported Dockview pinned-tab serialization is
quarantined rather than interpreted as application pinning.

## Implementation Phases

### Phase 0 — Contract tests and risk spikes

1. Pin Dockview Core and add it in a test-only harness.
2. Prove iframe boot ID, route, form draft, scroll, and heartbeat continuity during
   tab changes, docking, resize, moving an existing Code Panel beside its Agent,
   sole-tab group collapse, maximize/restore, Voyage switching, and teardown.
3. Prove Strict Mode does not double-create or double-dispose runtime entries.
4. Prove Open beside reuse/MRU selection, create-if-absent, pending-command
   idempotence, 50/50 placement, narrow-width fallback, and one-checkpoint undo;
   prove Open maximized serialization, reload, undo/redo, and visible Restore.
   Selection fixtures must prove that an older adjacent equivalent beats a newer
   non-adjacent equivalent, then prove durable MRU selection after reload and warm
   controller eviction, equal/missing-sequence stable-ID ties, focus metadata
   persistence without a layout-history checkpoint, and concurrent/repeated
   activation without duplicate Panels.
   If the pinned Core version omits maximize state from its snapshot, define and
   test a small versioned application presentation field persisted through the
   same aggregate coordinator; maximize may not silently become session-only.
5. Prototype Split View with a transient, non-persisted Dockview controller and
   fixed resizable Agent + Code hosts. Prove exclusive runtime leases, invoking
   controller pinning, identity-preserving detach/reattach, Split-only Code
   disposal, responsive single-surface fallback, route/Back/refresh semantics,
   idempotent failure cleanup, and zero underlying Voyage mutation events,
   `fromJSON` calls, layout writes, revision changes, or history checkpoints.
6. Inventory current built-in, VK, factory, pair, URL, plugin, React-surface, and
   ephemeral targets and implement the versioned target-registry contract tests.
7. Test the pinned Dockview serialization version, pre-`fromJSON` quarantine, and
   rejection of floating, popout, unknown-component, unsupported pinned-tab, and
   incompatible-version snapshots.
8. Disable floating/popout paths in v1 UI and document their behavior.
9. Prototype aggregate-CAS transactions covering membership, Panel, layout,
   history, serialized commands, conflicts, and atomic two-Voyage moves.
10. Feed consistent joined `kv.db` fixtures for every supported legacy envelope and
   classification through the timestamped migration prototype; verify balanced
   migrated/skipped/rejected counts and startup-failure atomicity. Include a fresh
   installation with neither key and a partial legacy installation with one key.
11. Create the resolver-derived provenance capability matrix and security harness.

**Exit:** every high-risk assumption has an automated reproduction and a recorded
pass/fail decision. If core docking cannot preserve required iframe identity,
stop and reevaluate Dockview before domain migration work.

### Phase 1 — Pure domain and repository

Write failing tests first for schema parsing, invariants, commands, revisions,
transactions, history bounds, quarantine, and idempotent migration. Then implement
the VD-owned SQLite repository and typed targets.

**Exit:** repository tests prove transaction rollback on failure, aggregate CAS,
atomic two-Voyage writes, and that migration fixtures preserve all approved data
while accounting for every intentional skip/rejection.

### Phase 2 — Dockview shell and Panel renderers

Add the workbench behind a development flag, stable renderer keys, deterministic
default layout, missing-target UI, and typed target dispatch. Use Panel IDs for
Dockview IDs and keep target data outside Dockview params.

**Exit:** all target families render in a static/restored layout without consulting
legacy layout topology.

### Phase 3 — Runtime retention and security

Integrate the iframe registry, warm-Voyage controller cache, LRU eviction, pointer
shield, provenance policy, redirect handling, and exactly-once cleanup.

**Exit:** browser tests prove continuity within budget, visible Panels are never
evicted, and unauthorized capabilities are absent.

### Phase 4 — Commands, persistence, and history

Implement open, focus, close, duplicate, rename, navigate, dock, reset, undo,
redo, add/remove/move Craft, flush, conflict handling, and quarantine recovery.

**Exit:** every command has success, validation-failure, persistence-failure, and
revision-conflict coverage.

### Phase 5 — Sidebar, attention, routing, and mobile

Build the collapsible Voyage browser, attention roll-ups, cross-Voyage Craft
drag/drop, query route resolver, compatibility redirects, and single-Panel mobile
experience.

**Exit:** desktop and mobile end-to-end tests cover resume, focus, attention jumps,
add/copy/move/remove, and legacy links.

### Phase 6 — Migration rollout and legacy removal

Exercise the one-way migration against fixtures and production-like copies, then
enable the new model. The startup migration runs once before writers and commits
only a complete normalized result. Remove legacy layout types and dependencies
after migration, parity, startup-failure, and forward-recovery tests pass. Retain
raw input only under the approved diagnostic retention policy.

“Remove legacy layout types” means remove them from runtime state and UI paths.
Keep isolated, frozen legacy input DTOs/parsers inside the timestamped migration
for installations that upgrade later; production runtime code must not import or
write those DTOs.

**Exit:** no production code writes legacy topology, migration is idempotent, and
forward recovery is documented and tested. No reverse exporter, legacy rollback,
or dual-write path exists.

### Phase 7 — Hardening and release

Complete accessibility, performance, security, failure-injection, container,
observability, and documentation passes. Test 1, 2, 10, and 30 Panels, repeated
Voyage switching, corrupted snapshots, missing VK targets, storage failures, and
interrupted layout gestures.

**Exit:** all definition-of-done checks pass with no open severity-1 or severity-2
defects.

## TDD and Verification Matrix

### Unit/repository

- unique Voyage membership with multiple repeated Panels;
- exhaustive Panel target validation and safe unknown-kind failure;
- external VK reference staleness;
- atomic domain/layout/history transactions and in-memory restoration on failure;
- monotonic revisions and stale-write rejection;
- bounded history and correct undo restoration;
- quarantine without accidental overwrite;
- legacy array/`sessions`/v2/v3 joined migration, classification balancing,
  idempotence, startup failure, and diagnostic-only raw input retention;
- provenance-to-capability mapping and redirect non-escalation;
- attention priority, deduplication, and Voyage/Craft roll-up;
- LRU behavior with configurable zero/minimum/large limits;
- linear history cursor, redo invalidation, pruning, and gesture coalescing;
- target registry versioning and Code equivalence without stored-path authority;
- activation counter monotonicity, present/equal/missing sequence ordering,
  deterministic migration/schema seeding, CAS conflicts, and no history entry for
  focus-only metadata;
- history serialization excludes the Voyage activation counter and Panel recency;
  focus changes after a structural checkpoint do not alter its projection;
  undo/redo never rewinds the counter; surviving Panels retain current recency;
  undo-close recreates a Panel with null recency; and subsequent Open Code
  selection uses current rather than historical recency;

### React integration

- renderers resolve only through Panel ID;
- missing targets render recovery UI rather than unrestricted content;
- restore installs one event subscription set and causes no redundant save;
- failed durable commands restore the in-memory Dockview state;
- close policy applies to tab button, menu, keyboard, and API paths;
- sidebar collapse, hierarchy, focus, drag semantics, and accessible alternatives;
- mobile route renders one Panel without an editable Dockview instance;
- Open Code split-button semantics, pending-command idempotence, accessible names,
  announced changes, post-attach focus, and keyboard Restore;
- suppression of restore-generated and other synthetic activation callbacks,
  exactly-once recording for user commands that focus programmatically,
  focus-noise coalescing, and persistence across reload/remount and
  warm-controller eviction;
- undo/redo restoration does not activate a recreated Panel; explicit user focus
  afterward assigns a fresh sequence through the coordinator without adding a
  layout-history checkpoint;

### Browser/end-to-end

- create/resume/archive Voyage and optional mission workflow;
- add, copy, move, reorder, and remove Crafts;
- open repeated views and share selected backend sessions across Voyages;
- split, reorder, resize, maximize, close, undo, redo, reload, and deep-link;
- iframe identity/draft/scroll/route continuity and LRU eviction disclosure;
- switch repeatedly between two warm Voyages without listener/DOM growth;
- malformed snapshot quarantine and explicit recovery;
- pending approval, running agent, and form attention navigation;
- legacy URL compatibility;
- keyboard-only and screen-reader smoke flows;
- hostile/redirected/custom/plugin/forwarded iframe capability cases;
- Agent-to-Code reuse/create, 50/50 and narrow fallback, sole-group collapse,
  maximize/restore, reload, undo/redo, and iframe identity continuity;
- temporary foreground Split View resizing, optional transient maximize, runtime
  lease ownership, return-host identity, Split-only disposal, controller pinning,
  route/Back/refresh/error cleanup, and proof that the Voyage receives no
  mutation, `fromJSON`, revision, layout-write, or history event;
- adjacent equivalent versus newer non-adjacent equivalent, equal/missing sequence
  tie-breaks, and concurrent/repeated activation without duplicate Code Panels;
- focus after a structural checkpoint followed by undo and redo, proving current
  recency survives for surviving Panels, recreated Panels remain null through
  restore callbacks, explicit focus assigns the next sequence, and Open Code
  selection remains deterministic throughout;
- one global iframe budget across two warm Voyages, including background and
  pinned inactive frames plus visible over-budget behavior;
- pre-`fromJSON` rejection of floating/popout/pinned/incompatible snapshots.

### Required quality gates per implementation PR

- focused tests added before or with production behavior;
- `npm run check-types` for changes under `src`;
- relevant Vitest/Storybook/Playwright suites;
- lint/format checks used by the repository;
- GitNexus impact analysis before symbol edits and `detect_changes` before commit;
- local working tree and migration artifacts reviewed for unintended changes.

## Rollout and Observability

- Feature flag the new persistence and rendering path only for pre-cutover
  development and test environments. After a successful one-way migration, the
  flag cannot reactivate legacy readers or writers.
- Run schema migrations and then the timestamped one-way data migration before any
  application writer starts. Never dual-write, reverse-export, or resume legacy
  state. There is no legacy rollback stage.
- Retain the joined raw legacy envelope only as a timestamped, access-controlled
  diagnostic artifact with an explicit retention limit. It is not a backup and
  cannot become authoritative.
- Emit structured metrics for restore result, quarantine reason, migration counts,
  save latency/failure, revision conflicts, iframe creation/eviction/disposal,
  warm Voyage count, and attention-source freshness.
- Do not log full custom URLs, snapshot JSON, missions, iframe content, tokens, or
  credentials.
- A failed migration prevents startup and leaves `vd.sqlite` without partial target
  rows or a success ledger entry. After success, incidents use normalized history,
  quarantine, repair migrations, and other forward-recovery mechanisms only.

## Proposed Pull Request Sequence

1. Dockview/iframe contract harness and go/no-go report.
2. SQLite schema, typed domain model, repository transactions, and tests.
3. Joined-state one-way data migration, existing ledger, balanced diagnostics,
   startup atomicity, and forward-recovery fixtures.
4. Dockview shell, renderer registry, default layout, and recovery Panel.
5. Iframe runtime retention, warm Voyage cache, and provenance policy.
6. Command coordinator, autosave, conflicts, quarantine, and persisted history.
7. Voyage sidebar, attention adapters, and Craft drag/copy/move workflows.
8. Canonical routing, compatibility redirects, and mobile single-Panel mode.
9. Legacy layout removal and dependency cleanup.
10. Accessibility, performance, security, observability, and release documentation.

Every PR must be independently buildable and tested. No PR may intentionally land
broken types, skipped required tests, a partial database migration, or two active
layout authorities.

## Review Defaults

These are implementation defaults, not unresolved architecture questions:

- warm Voyage limit: **2**;
- global maximum total iframe budget: **5**, with visible-work protection;
- history limit: **50** checkpoints per Voyage;
- layout autosave debounce: **300 ms**;
- ordinary cross-Voyage drag: **add/copy membership**;
- explicit menu/command action: **move membership atomically**;
- agent “needs attention”: **structured pending approval/question only**;
- unrecognized agent state: **unknown**, never inferred from elapsed time;
- default new Voyage layout: **adaptive useful work area, no mandatory overview
  Panel**;
- iframe budget scope: **one global runtime budget; all background frames inactive**;
- Open beside: **same-Voyage adjacent-first, then durable-MRU reuse/move; create
  only when absent**;
- Open maximized: **Dockview group maximize, never browser Fullscreen API**.
- Split View: **transient restricted Dockview controller, never a temporary
  Voyage; session-only geometry and no underlying Voyage mutation**.

Reviewers should change these values if product testing provides evidence, but
their exact values do not block the architecture.

## Definition of Done

- [ ] Dockview Core is the only desktop layout authority.
- [ ] The VD-owned normalized SQLite schema and migrations are production-ready.
- [ ] VK Crafts and Voyage memberships migrate from one consistent joined read;
      all skipped/rejected legacy records balance with IDs and reasons.
- [ ] One membership supports multiple repeated typed Panels.
- [ ] Domain, layout, and history writes are atomic and revision checked.
- [ ] Malformed snapshots are quarantined and recoverable.
- [ ] Persisted layout/Panel undo and redo meet the selected history boundary.
- [ ] Two warm Voyages and the configurable global iframe budget behave as specified.
- [ ] Supported layout operations preserve retained iframe identity.
- [ ] Sidebar overview, hierarchy, attention roll-up, and Craft transfer work.
- [ ] Canonical and compatible deep links restore and focus deterministically.
- [ ] Mobile provides a complete single-Panel workflow.
- [ ] Provenance-derived iframe capabilities pass the security test matrix.
- [ ] The versioned target registry covers every current factory/surface and fails
      closed for unknown or unavailable targets.
- [ ] Open beside/maximized satisfy reuse, identity, accessibility, persistence,
      history, and narrow-width contracts.
- [ ] Split View provides a resizable temporary Agent + Code workbench, returns
      to the unchanged Voyage, and passes lease, routing, cleanup, budget, and
      no-mutation contracts.
- [ ] Legacy layout state, UI, and unused dependencies are removed.
- [ ] Unit, repository, integration, browser, accessibility, and manual checks pass.
- [ ] One-way cutover, forward recovery, operational diagnostics, and
      user/architecture docs are complete.
