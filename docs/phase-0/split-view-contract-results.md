# Phase 0 temporary Split View contract

Status: **GO** for the approved transient Split View architecture, subject to
the contracts below. This is isolated evidence, not production integration.

## Proven controller and runtime boundary

`TEST_CASE_M1_5C` creates a durable Voyage Dockview and a separate transient,
restricted Dockview. The transient controller owns only two empty renderer
roots and invocation geometry. A window-global runtime layer retains the one
physical iframe payload while an exclusive logical lease changes its attachment
from the durable host to the transient host. Chromium proves the iframe boot ID,
heartbeat, listener count, and browsing `WindowProxy` survive the attachment.
It queries only application-captured renderer roots, never Dockview private DOM.

The durable controller remains mounted and pinned. Enter, native sash resize,
per-side maximize/restore, responsive topology changes, and teardown produce no
durable mutation event, `fromJSON`, write, revision, or history checkpoint and
leave its serialized layout and active invoking Panel unchanged. Durable single-
Panel maximize remains a separate command that creates no Split View.

## Runtime transaction and recovery

The executable registry model provides generation-checked, single-host leases.
Two-runtime acquisition is transactional and rolls the first lease back if the
second fails. Leaseable iframe targets retain their physical runtime;
recreatable React/application targets receive a collision-safe `split:` runtime
with explicit fresh-state semantics and no durable Panel or recency row;
unsupported targets fail with a deterministic reason. Same-Craft candidates
rank first, while capability-compatible cross-Craft Agent, Code, Forms, plugin,
and other target kinds are not rejected by hard-coded kind assumptions.

The invoking controller is pinned and both payloads count against the global
budget until exact teardown. Split-only runtimes dispose once. Repeated entry,
abort, visible Back, browser Back, and teardown are idempotent. Generation
replacement, authoritative Panel/host deletion, Voyage replacement, or plugin
invalidation never recreates stale state: the lease is disposed/released and
focus falls back safely rather than restoring a snapshot.

## Responsive and routing behavior

Wide mode is two groups with a real Dockview sash and 240px minimum renderer
widths. Either side maximizes and restores. Narrow mode reconstructs the
transient controller as one two-tab group with the invoking surface active; it
does not CSS-hide a side. The resized ratio survives wide/narrow transitions
within an invocation, including a transition while maximized, but a new
invocation and refresh start at 50/50. Exit while maximized follows the same
cleanup path.

Only `split=1`, `withCraft`, and `withSurface` are accepted as route intent,
using strict stable-key syntax; unknown parameters, path-like keys, stale
targets, failed resolution, and unsupported combinations fail closed without
Voyage mutation. Refresh reconstructs through current trusted definitions and
does not promise pre-refresh DOM identity.

## Go/no-go conclusion

**GO.** Dockview 8.3.1 supplies the required native resize and group maximize
behavior without making the transient controller a persistence authority. The
production implementation must retain the global payload owner, exclusive
generation-bearing leases, transactional acquisition, controller pin/budget
ordering, strict route resolver, public renderer-root boundary, and exact
idempotent cleanup demonstrated here. Floating, popout, arbitrary docking,
add/move/close, transient persistence, and Voyage `fromJSON` remain forbidden.
