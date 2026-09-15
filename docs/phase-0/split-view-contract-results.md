# Phase 0 temporary Split View contract

Status: **GO** for the approved transient Split View architecture, subject to
the contracts below. This is isolated evidence, not production integration.

## Proven controller and runtime boundary

`TEST_CASE_M1_5C` creates a durable Voyage Dockview and a separate transient,
restricted Dockview. The transient controller owns only two empty renderer
roots and invocation geometry. A window-global runtime layer retains the one
physical iframe payload. It starts at a public-callback-created, generation-
bearing durable host, leases to the transient host, and returns to that exact
still-valid durable host. Chromium proves the iframe boot ID,
heartbeat, listener count, and browsing `WindowProxy` survive the attachment.
It queries only application-captured renderer roots, never Dockview private DOM.

The durable controller remains mounted and is pinned before resolution and
acquisition. Enter, native sash resize,
per-side maximize/restore, responsive topology changes, and teardown produce no
durable mutation event or call to injected coordinator, `toJSON`, `fromJSON`,
repository-write, revision, history, or autosave adapters and
leave its serialized layout and active invoking Panel unchanged. Durable single-
Panel maximize remains a separate command that creates no Split View.

## Runtime transaction and recovery

The executable registry models `inactive -> entering(token) -> active(token) ->
exiting(token) -> inactive`, rejects overlapping and stale transitions, and
provides generation-checked single-host leases. It pins before lookup and
acquisition, acquires in stable runtime-identity order, and rolls back in reverse
order if the second acquisition fails. Leaseable iframe targets retain their physical runtime;
recreatable React/application targets receive a collision-safe `split:` runtime
with explicit fresh-state semantics and no durable Panel or recency row;
unsupported targets fail with a deterministic reason. Same-Craft candidates
rank first, while capability-compatible cross-Craft Agent, Code, Forms, plugin,
and other target kinds are not rejected by hard-coded kind assumptions.

The invoking controller is pinned and both payloads count against the global
budget until exact teardown. A concrete one-controller budget rejects eviction
while pinned and admits it after release. Split-only runtimes dispose once. Repeated entry,
abort, visible Back, browser Back, and teardown are idempotent. Generation
replacement, authoritative Panel/host deletion, Voyage replacement, or plugin
invalidation immediately runs detach/dispose before unpin and never recreates
stale state: the lease is disposed/released and
focus falls back safely rather than restoring a snapshot.

## Responsive and routing behavior

Wide mode is two groups with a real Dockview sash and 240px minimum renderer
widths. Either side maximizes and restores. Narrow mode reconstructs the
transient controller as one two-tab group with the invoking surface active; it
does not CSS-hide a side. The resized ratio survives wide/narrow transitions
within an invocation, including a transition while maximized, but a new
invocation and refresh start at 50/50. Exit while maximized follows the same
cleanup path.

The production-shaped route is `/voyages/:voyageId/split/:invokingPanelToken`
with optional `withCraft` and required `withSurface`. Its executable resolver
requires the current Voyage, durable invoking Panel, Voyage Craft membership,
installed and authorized registered surface, current Split capability, and a
compatible runtime. Unknown parameters, path-like keys, deleted or stale
records, removed definitions, unauthorized surfaces, failed resolution, and
unsupported combinations fail closed without Voyage mutation. Stored route
values never supply runtime capability or URLs. Refresh reconstructs through current trusted definitions and
does not promise pre-refresh DOM identity.

## Go/no-go conclusion

**GO.** Dockview 8.3.1 supplies the required native resize and group maximize
behavior without making the transient controller a persistence authority. The
production implementation must retain the global payload owner, exclusive
generation-bearing leases, transactional acquisition, controller pin/budget
ordering, strict route resolver, public renderer-root boundary, and exact
idempotent cleanup demonstrated here. Floating, popout, arbitrary docking,
add/move/close, transient persistence, and Voyage `fromJSON` remain forbidden.
