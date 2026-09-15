# Phase 0 temporary Split View contract

Status: **GO** for the approved transient Split View architecture after the
executable evidence below passed. It remains subject to
the contracts below. This is isolated evidence, not production integration.

## Proven controller and runtime boundary

`TEST_CASE_M1_5C` creates a durable Voyage Dockview and a separate transient,
restricted Dockview. The transient controller owns only two empty renderer
roots and invocation geometry. A window-global runtime layer retains Agent,
Code, and installed-plugin iframe payloads. The selected two runtimes start at
public-callback-created, generation-bearing durable hosts, lease to transient
hosts, and return to those exact still-valid durable hosts. Chromium proves the
Agent/Code browsing `WindowProxy` values and fixture boot IDs survive the
attachment, and separately exercises a real installed-plugin target resolved
through trusted plugin definitions.
It queries only application-captured renderer roots, never Dockview private DOM.

The durable controller remains mounted and is pinned before resolution and
acquisition. Enter, native sash resize,
per-side maximize/restore, responsive topology changes, and teardown produce no
durable mutation event. A shared Split application dispatch seam routes enter,
resize, maximize/restore, responsive changes, invalidation, races, and exit to
transient ports. Injected throwing/spying coordinator, serializer, `fromJSON`,
repository, revision, history, and autosave ports remain untouched, while a
control test proves the durable side of the seam is live and throws if selected.
These operations leave its serialized layout and active invoking Panel unchanged. Durable single-
Panel maximize remains a separate command that creates no Split View.

## Runtime transaction and recovery

The executable registry and Chromium harness model `inactive ->
entering(token) -> active(token) -> exiting(token) -> inactive`, reject
overlapping and stale transitions, and provide generation-checked single-host
leases. Entering state is token-owned: pending Voyage/target/plugin identities
and incrementally acquired leases live on the transition. Back or authoritative
target, plugin, Voyage, or host invalidation during pending entry cancels that
token, reverse-releases acquired leases, disposes Split-only runtimes exactly
once, unpins, and prevents stale completion from publishing active. It pins
before lookup and acquisition, acquires in stable runtime-identity order, and
rolls back in reverse order if the second acquisition fails. Every lease records
trusted target identity, plugin identity where applicable, and disposal
ownership. Leaseable
iframe targets retain their physical runtime;
recreatable React/application targets receive a collision-safe `split:` runtime
with explicit fresh-state semantics and no durable Panel or recency row. The
recreatable-first/leaseable-second failure path reverse-rolls back and disposes
the transient exactly once.
unsupported targets fail with a deterministic reason. Same-Craft candidates
rank first, while capability-compatible cross-Craft Agent, Code, Forms, plugin,
and other target kinds are not rejected by hard-coded kind assumptions.

The invoking controller is pinned and the selected two runtime registrations
count against the global two-runtime active budget until exact teardown. The
budget manager derives counts from retained, Split-only, and competing runtime
registrations rather than phase constants. Concrete pressure rejects competing
controller eviction while pinned and admits it after release. Split-only
runtimes dispose once. Repeated entry,
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

The production-shaped route intent is
`?voyage=<voyage-token>&split=<invoking-panel-token>&withCraft=<craft-token>&withSurface=<surface-key>`;
`withCraft` is optional and defaults to the invoking Panel's authoritative
Craft. The resolver reuses M1.3 `resolvePanelTarget` and
`findCompatibleSplitTargets`, requiring current Panel-to-Craft ownership,
Craft-scoped surface identity, installed/authorized definitions, effective
capabilities, equivalence, and compatible runtime. Duplicate or unknown query
keys, path-like keys, deleted or stale
records, removed definitions, unauthorized surfaces, failed resolution, and
unsupported combinations fail closed without Voyage mutation. Stored route
values never supply runtime capability or URLs. Chromium covers Agent + Forms,
Forms + Code, and permitted cross-Craft Forms/Code selections. Refresh
reconstructs through current trusted definitions and
does not promise pre-refresh DOM identity.

## Go/no-go conclusion

**GO.** Dockview 8.3.1 supplies the required native resize and group maximize
behavior without making the transient controller a persistence authority. The
production implementation must retain the global payload owner, exclusive
generation-bearing leases, transactional acquisition, controller pin/budget
ordering, strict route resolver, public renderer-root boundary, and exact
idempotent cleanup demonstrated here. Floating, popout, arbitrary docking,
add/move/close, transient persistence, and Voyage `fromJSON` remain forbidden.
