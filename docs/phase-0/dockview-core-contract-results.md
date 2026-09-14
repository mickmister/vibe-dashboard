# Dockview Core 8.3.1 contract spike

Date: 2026-09-14

## Decision

Pin `dockview` and `dockview-react` to exactly `8.3.1`, and force the transitive
`dockview-core` package to exactly `8.3.1` with a pnpm override. Dockview's
official package guidance says `dockview-core` is an internal package and that
applications should install `dockview` or a framework binding instead. The
React binding declares React 19 support, matching this repository's React
19.2.4. The override is still necessary because the public packages otherwise
declare caret ranges for their internal dependency, which is too weak for a
persisted serialization contract.

Primary references:

- <https://www.npmjs.com/package/dockview-core/v/8.3.1>
- <https://www.npmjs.com/package/dockview-react/v/8.3.1>
- <https://dockview.dev/docs/core/events/>
- <https://dockview.dev/docs/core/groups/floatingGroups/>
- <https://dockview.dev/docs/core/state/serialization/>

## Executable evidence

Run:

```sh
pnpm test:contract:dockview
```

The isolated Vite/Playwright spike proves the following against Chromium:

1. `addPanel`, split placement, `panel.api.moveTo`, group maximize, and restore
   work without a React application integration.
2. Every observed top-level structural operation emits one matched
   `onWillMutateLayout` / `onDidMutateLayout` pair with the same kind and origin.
   Add, split, and move invoked via Dockview APIs report `api`. Calling
   `panel.api.maximize()` from a button click reports `user` in 8.3.1, while
   `api.exitMaximizedGroup()` reports `api`. Therefore persistence must use the
   paired boundary, not assume every application command has `origin === api`.
3. `toJSON`/`fromJSON` round-trips panel IDs, stable lookup params, split
   structure, and maximized state exactly for the pinned version.
4. Native `fromJSON({})` fails synchronously with
   `dockview: root must be of type branch`. Native failure is not a sufficient
   trust boundary because it occurs after Dockview begins interpreting input.
5. The spike's versioned envelope validator rejects malformed layouts, future
   format versions, unknown component keys, pinned tabs, floating groups,
   popouts, and edge groups into a quarantine boundary before calling
   `fromJSON`; the live layout remains unchanged.
6. `disableFloatingGroups: true` prevents Shift-dragging a tab into floating
   state. No application command exposes `addFloatingGroup` or
   `addPopoutGroup`; persisted floating/popout input is rejected. This is the
   required defense in depth because public APIs still exist.
7. Native tab semantics support arrow-key traversal. Explicit, labeled buttons
   exercise add-beside, maximize, and restore with keyboard activation, proving
   non-drag alternatives are viable.

## Go/no-go implications

**Go** for the approved Dockview Core architecture on the pinned 8.3.1 line.
The required layout, serialization, mutation-boundary, restriction, and keyboard
contracts are available without Enterprise features.

The following remain hard implementation constraints rather than blockers:

- persisted snapshots must carry both the application format version and exact
  Dockview version;
- validation and quarantine must run before `fromJSON`;
- floating/popout/edge/pinned state must be rejected, not merely hidden;
- mutation pairing is authoritative; `origin` is useful context but cannot be
  the sole test for whether an operation belongs in application history;
- upgrades require rerunning this suite and explicit snapshot compatibility
  fixtures before changing the exact pins.

This spike deliberately contains no Voyage repository, mutation coordinator,
target registry, migration, or production workbench code. Those belong to later
milestones.

## M1.2 iframe lifecycle results

The harness now includes a same-origin iframe fixture instrumented with a random
boot ID, heartbeat and event-listener counters, native input and textarea state,
scroll position, document visibility, Dockview Panel visibility, and containing
Voyage visibility.

With `renderer: 'always'`, the same iframe document and its native state survive:

- creating a neighboring split and moving the iframe Panel between groups;
- hiding it behind another tab and showing it again;
- maximizing and restoring its group;
- switching away from and back to another already-mounted (“warm”) Dockview
  controller; and
- applying an undo/redo-shaped `fromJSON(snapshot, { reuseExistingPanels: true })`
  restoration.

The in-place restore emits one matched `will:load` / `did:load` mutation pair.
This reinforces the M1.1 result: coordination should consume matched mutation
boundaries; `origin` is metadata and is not sufficient on its own.

Hidden does not mean inactive. While an always-rendered Panel is hidden behind a
tab, and while its warm Voyage container is hidden, its iframe heartbeat and
listener counters continue advancing. `document.visibilityState` also remains
browser-page visibility rather than application Panel visibility. The production
runtime must therefore combine Dockview's `panel.api.isVisible` with active
Voyage state and explicitly pause cooperative work; CSS visibility alone does not
enforce the global iframe budget.

Removal/disposal followed by recreation intentionally produces a new boot ID and
empty native form/editor/scroll state. A browser page reload does the same. Those
are expected reload boundaries and must not be presented as state-preserving
operations. Persisted application data may reconstruct a route or draft, but it
cannot preserve the old iframe document identity.
