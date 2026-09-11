# Dockview Voyage Workbench Implementation Plan

## Status

**Proposed for review.** This document incorporates the completed product forms,
the VD and VK repository audit, the prior SubVoyage prototype review, and the
Herdr source review. It replaces the older clean-break proposal.

Implementation must not begin with a wholesale UI rewrite. The first deliverable
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
- iframe provenance and granted capabilities.

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
   controllers and five retained inactive iframe instances; both limits are
   configurable.
6. Domain mutations, Panel definitions, layout snapshots, and history entries
   that form one operation commit in one SQLite transaction.
7. Existing Crafts and recoverable Voyage membership migrate from the current
   `SavedWorkspaceSession` formats without silent loss.
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

## Durable Data Model

### SQLite ownership

VD owns a dedicated normalized SQLite schema. VK Workspace, session, process,
repository, and preview IDs are external logical references validated through VK
APIs. Do not add cross-database foreign keys or make VD depend on VK's physical
database layout.

Suggested tables (exact naming may follow the repository's Prisma conventions):

```text
voyages
  id, schema_version, name, mission, lifecycle_state,
  created_at, updated_at, last_opened_at

voyage_crafts
  voyage_id, craft_workspace_id, sort_key, created_at, updated_at
  PRIMARY KEY (voyage_id, craft_workspace_id)

voyage_panels
  id, voyage_id, craft_workspace_id NULL,
  target_kind, target_payload_json,
  title_mode, custom_title NULL, close_policy,
  created_at, updated_at

voyage_layouts
  voyage_id, format_version, dockview_version,
  revision, snapshot_json, snapshot_hash, updated_at

voyage_history
  id, voyage_id, sequence, layout_revision,
  panels_json, snapshot_json, created_at

voyage_layout_quarantine
  id, voyage_id, source_revision, reason_code,
  rejected_snapshot_json, created_at, resolved_at NULL

voyage_settings
  singleton_key, warm_voyage_limit, retained_iframe_limit, updated_at

migration_ledger
  migration_key, source_hash, status, diagnostics_json, completed_at
```

`voyage_crafts.craft_workspace_id` is deliberately not a database foreign key.
The application should report missing VK Workspaces as stale external references
and offer removal or relinking rather than failing SQLite integrity checks.

### Typed Panel targets

Persist a validated discriminated union. Initial variants should be based on
actual current surfaces, not speculative abstractions:

```ts
type PanelTarget =
  | { kind: 'craft-overview'; workspaceId: string }
  | { kind: 'agent-session'; workspaceId: string; sessionId: string }
  | { kind: 'code'; workspaceId: string; repoId?: string }
  | { kind: 'changes'; workspaceId: string; repoId?: string }
  | { kind: 'beads'; workspaceId: string }
  | { kind: 'forms'; workspaceId: string; formId?: string }
  | { kind: 'terminal'; workspaceId: string; terminalId: string }
  | { kind: 'preview'; workspaceId: string; previewId: string }
  | { kind: 'internal-route'; routeId: string; params: JsonObject }
  | { kind: 'custom-url'; url: string; provenance: UrlProvenance }
  | { kind: 'plugin-surface'; pluginId: string; surfaceId: string; params: JsonObject };
```

The persisted Dockview Panel ID equals `voyage_panels.id`. Dockview params contain
only a version and stable Panel lookup ID. URLs, credentials, permissions, and VK
objects must not be copied into the opaque Dockview snapshot.

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

### Transaction boundary

All mutations go through a server-side repository. A command that changes Panels
and layout must, in one SQLite transaction:

1. validate the expected Voyage/layout revision;
2. apply domain row changes;
3. write the resulting opaque Dockview snapshot;
4. append the bounded history checkpoint when applicable;
5. increment the revision and commit.

Stale revisions return a typed conflict. They never silently overwrite newer
state. Multi-user collaborative layout merging is out of scope.

### Autosave

- Capture structural mutation boundaries immediately.
- Debounce resize/noisy layout events, initially at 300 ms.
- Create history checkpoints at completed user-action boundaries. Coalesce an
  entire resize or drag gesture into one checkpoint rather than adding one entry
  for every autosave event.
- Hash the canonical serialized snapshot and skip unchanged writes.
- Flush before switching Voyages, page teardown, cache eviction, or repository
  shutdown where the platform permits it.
- Never rely on `beforeunload` as the only durability mechanism.

### Undo and redo

Persist a bounded, configurable history, initially 50 checkpoints per Voyage.
Each checkpoint contains the Dockview snapshot and the Voyage-owned Panel
definitions required to reverse open, close, move, and rearrange actions.

History explicitly excludes:

- Voyage mission/name changes;
- Craft membership changes;
- VK Workspace, repository, session, process, or agent mutations;
- iframe document state.

Craft removal therefore uses a separate confirmation and short-lived “Undo
removal” command, not the layout history stack.

### Malformed layout recovery

1. Parse and schema-check domain rows and the snapshot before constructing live
   Panels.
2. Verify unique Panel IDs, registered renderer keys, target payloads, Voyage
   ownership, and membership references.
3. On failure, insert the rejected snapshot and reason into quarantine.
4. Build a deterministic safe layout from valid Panels or valid memberships.
5. Show a recovery notice with retry, inspect diagnostics, reset, and restore
   previous-history options.
6. Do not overwrite the rejected durable snapshot merely because fallback UI
   rendered. Commit a replacement only after an explicit recovery action or a
   valid subsequent workbench mutation.

## Migration Contract

Support current persisted `SavedWorkspaceSession` v1, v2, and v3 inputs.

Migration rules:

1. Preserve every resolvable Craft/VK Workspace identity.
2. Preserve Voyage names, ordering, selected views, and membership where the old
   representation contains them.
3. Coalesce duplicate occurrences of one Craft in one Voyage into one membership.
4. Convert each occurrence's selected `viewIds` into separate Panel definitions;
   never discard a useful duplicate view merely because membership was coalesced.
5. Convert legacy pairs/cells/tiles into a deterministic initial Dockview layout
   only once. Dockview owns all later topology.
6. Record stale targets and repair decisions in migration diagnostics.
7. Make migration idempotent using a source hash and ledger entry.
8. Retain the untouched source payload for rollback until the release's rollback
   window expires.
9. Validate migrated counts and references before marking migration complete.

The prior SubVoyage work contributes stable selected-view references, Craft
provenance labels, stale-reference repair, explicit focus routing, iframe identity
lessons, and regression tests. Its cell/tile topology, responsive CSS grid,
`TabPair` ratios, and parallel active-item maps are superseded by Dockview.

## Runtime Architecture

Suggested boundaries:

```text
src/voyages/domain/*                 pure types, invariants, commands, selectors
src/voyages/persistence/*.node.ts    SQLite repository and migrations
src/voyages/migration/*              SavedWorkspaceSession migration
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
- Add a parent-document pointer shield during drag/resize and restore pointer
  behavior on drop, cancellation, blur, error, and teardown.
- Never evict visible Panels.
- Evict inactive iframe runtimes by LRU when the configurable limit is exceeded;
  disclose that returning to an evicted iframe reloads its page-local state.
- Keep the active and most-recent Voyage controller warm by default. Controller
  eviction flushes persistence and tears down subscriptions exactly once.

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
/?voyage=<voyageId>
/?voyage=<voyageId>&craft=<workspaceId>
/?voyage=<voyageId>&panel=<panelId>
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

Preserve `/dashboard/workspaces/:workspaceId` as the existing VD/VK Workspace
opener. Resolve supported legacy Craft/view links and redirect to the canonical
Voyage query form. Invalid focal parameters must not mutate the saved layout.

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

## Implementation Phases

### Phase 0 — Contract tests and risk spikes

1. Add Dockview Core in a test-only harness.
2. Prove iframe boot ID, route, form draft, scroll, and heartbeat continuity during
   tab changes, docking, resize, maximize, and teardown.
3. Prove Strict Mode does not double-create or double-dispose runtime entries.
4. Disable floating/popout paths in v1 UI and document their behavior.
5. Prototype SQLite transactions covering membership, Panel, layout, and history.
6. Feed representative v1-v3 saved sessions through a migration prototype and
   compare source/migrated counts.
7. Create the provenance capability matrix and security test harness.

**Exit:** every high-risk assumption has an automated reproduction and a recorded
pass/fail decision. If core docking cannot preserve required iframe identity,
stop and reevaluate Dockview before domain migration work.

### Phase 1 — Pure domain and repository

Write failing tests first for schema parsing, invariants, commands, revisions,
transactions, history bounds, quarantine, and idempotent migration. Then implement
the VD-owned SQLite repository and typed targets.

**Exit:** repository tests prove atomic commit/rollback and migration fixtures
preserve memberships and Panels.

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

Run migration in shadow/report-only mode against fixtures and production-like
backups, enable Dockview for opted-in development, then switch the default. Remove
legacy layout types and dependencies only after rollback and parity tests pass.

**Exit:** no production code writes legacy topology, migration is idempotent, and
rollback remains documented and tested.

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
- atomic domain/layout/history transactions and rollback;
- monotonic revisions and stale-write rejection;
- bounded history and correct undo restoration;
- quarantine without accidental overwrite;
- v1/v2/v3 migration, coalescing, idempotence, and rollback payload retention;
- provenance-to-capability mapping and redirect non-escalation;
- attention priority, deduplication, and Voyage/Craft roll-up;
- LRU behavior with configurable zero/minimum/large limits.

### React integration

- renderers resolve only through Panel ID;
- missing targets render recovery UI rather than unrestricted content;
- restore installs one event subscription set and causes no redundant save;
- failed durable commands restore the in-memory Dockview state;
- close policy applies to tab button, menu, keyboard, and API paths;
- sidebar collapse, hierarchy, focus, drag semantics, and accessible alternatives;
- mobile route renders one Panel without an editable Dockview instance.

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
- hostile/redirected/custom/plugin/forwarded iframe capability cases.

### Required quality gates per implementation PR

- focused tests added before or with production behavior;
- `npm run check-types` for changes under `src`;
- relevant Vitest/Storybook/Playwright suites;
- lint/format checks used by the repository;
- GitNexus impact analysis before symbol edits and `detect_changes` before commit;
- local working tree and migration artifacts reviewed for unintended changes.

## Rollout and Observability

- Feature flag the new persistence and rendering path during development.
- Never dual-write legacy and new layout models. Shadow migration may compare, but
  only one model is authoritative for a user at a time.
- Back up the legacy aggregate before first migration.
- Emit structured metrics for restore result, quarantine reason, migration counts,
  save latency/failure, revision conflicts, iframe creation/eviction/disposal,
  warm Voyage count, and attention-source freshness.
- Do not log full custom URLs, snapshot JSON, missions, iframe content, tokens, or
  credentials.
- Define an explicit rollback window and test rollback using the retained source
  aggregate before enabling the migration by default.

## Proposed Pull Request Sequence

1. Dockview/iframe contract harness and go/no-go report.
2. SQLite schema, typed domain model, repository transactions, and tests.
3. Saved-session migration, ledger, diagnostics, and rollback fixtures.
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
- retained inactive iframe limit: **5**;
- history limit: **50** checkpoints per Voyage;
- layout autosave debounce: **300 ms**;
- ordinary cross-Voyage drag: **add/copy membership**;
- explicit menu/command action: **move membership atomically**;
- agent “needs attention”: **structured pending approval/question only**;
- unrecognized agent state: **unknown**, never inferred from elapsed time;
- default new Voyage layout: **adaptive useful work area, no mandatory overview
  Panel**.

Reviewers should change these values if product testing provides evidence, but
their exact values do not block the architecture.

## Definition of Done

- [ ] Dockview Core is the only desktop layout authority.
- [ ] The VD-owned normalized SQLite schema and migrations are production-ready.
- [ ] Existing Crafts and Voyage memberships migrate without silent loss.
- [ ] One membership supports multiple repeated typed Panels.
- [ ] Domain, layout, and history writes are atomic and revision checked.
- [ ] Malformed snapshots are quarantined and recoverable.
- [ ] Persisted layout/Panel undo and redo meet the selected history boundary.
- [ ] Two warm Voyages and configurable iframe retention behave as specified.
- [ ] Supported layout operations preserve retained iframe identity.
- [ ] Sidebar overview, hierarchy, attention roll-up, and Craft transfer work.
- [ ] Canonical and compatible deep links restore and focus deterministically.
- [ ] Mobile provides a complete single-Panel workflow.
- [ ] Provenance-derived iframe capabilities pass the security test matrix.
- [ ] Legacy layout state, UI, and unused dependencies are removed.
- [ ] Unit, repository, integration, browser, accessibility, and manual checks pass.
- [ ] Rollback, operational diagnostics, and user/architecture docs are complete.
