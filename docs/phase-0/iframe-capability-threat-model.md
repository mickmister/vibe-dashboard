# Phase 0 iframe capability threat model

Status: **GO** for production implementation behind the versioned target
registry; **NO-GO** for reusing the current base-domain heuristic unchanged.

Executable evidence is in
`spikes/dockview-contract/iframeCapabilityPolicy.ts`, its unit test, and the
Chromium contract in `tests/dockview-contract/iframe-capability.spec.ts`. This
is an isolated contract, not production integration. It records
`TEST_CASE_M1_4A`.

## Current behavior inventory

`IframePanel.applyIframePolicy` currently treats any URL with the same derived
base domain as trusted. `originTrust` strips a `port-<number>.` prefix and uses
the final two hostname labels, so sibling and forwarded hosts receive
`allow-same-origin`, forms, popups, modals, clipboard read/write, and fullscreen.
Other URLs still receive scripts, forms, popups, modals, and fullscreen.

Installed plugin frontend assets are already narrower: scripts, optional
same-origin only on a separate origin, and fullscreen. However, the generic
non-plugin fallback is broader, and the opaque-origin plugin postMessage target
falls back to `*`. The iframe bead/form listener validates message shape and a
known source iframe but not origin. The workspace shortcut listener checks a
known source and the same base-domain heuristic, but not Panel/runtime identity
or a target generation.

The Caddy `^port-([0-9]+)\.` host matcher proxies directly to that localhost
port. It is a transport mechanism inside the current protected sandbox, not an
application provenance attestation. Host suffix resemblance, a forwarded port,
and `X-Vibe-Requested-Host` therefore cannot grant iframe capabilities.

## Resolver-derived policy contract

Persisted data supplies a stable lookup key only. Current trusted resolvers
supply the URL, provenance, requested capabilities, installed-plugin state, and
generation. Serialized `claimedProvenance` or `claimedCapabilities` fields have
no effect. Unknown definitions, malformed URLs, missing plugins, and invalid
messages fail closed. Both current-definition capability requests and installed-
contribution allowlists are runtime-validated as recognized capability arrays;
null, non-array, or unknown-token data returns typed `invalid-definition` rather
than being filtered permissively or throwing.

| Class | Sandbox ceiling | Permissions Policy ceiling |
| --- | --- | --- |
| `vd-built-in` | scripts, same-origin, forms, modals | clipboard read/write, fullscreen |
| `vk-built-in` | scripts, same-origin, forms, modals | clipboard read/write, fullscreen |
| `installed-plugin` | scripts; always opaque-origin in v1 | manifest-requested fullscreen |
| `forwarded-project` | scripts, forms | none |
| `external-url` | scripts | none |

All classes deny downloads, popups, popup escape, and top navigation by user
activation. A false value is meaningful: omission from the generated `sandbox`
or `allow` attribute is the denial. Plugin manifests can request only within the
VD ceiling; removal or tightening takes effect on the next trusted resolution.
Plugin same-origin is **NO-GO for v1**, including when a manifest requests it.
The exact current installed plugin version and registered contribution are still
required before granting any allowed capability, and current contribution policy
is intersected with the VD ceiling. Removal, version mismatch, contribution
removal, or tightening fails closed. Future plugin same-origin support requires
a separate browser-enforced navigation and per-plugin isolation design proving
HTTP redirects plus script, link, form, and meta navigation cannot reach a
privileged destination; an HTTP redirect walker alone is insufficient.

The built-in ceilings preserve the current VK/code-server clipboard, form,
modal, and fullscreen behavior. Forwarded project servers deliberately lose
ambient clipboard, same-origin, popup, modal, and fullscreen privilege until a
separately reviewed, stable route definition proves that functionality requires
a narrower explicit grant. This is a visible compatibility impact, not a silent
change. External URLs likewise tighten from the current forms/popups/modals and
fullscreen fallback to scripts only.

## HTTP redirect enforcement, host confusion, and Caddy threats

`acceptsNavigation` was removed because a predicate cannot constrain a browser.
Any target receiving same-origin or clipboard capability must instead use a
trusted server/registry-selected delivery endpoint. Guard identity and
configuration are not accepted from stored or target-definition data. The
endpoint fetches with redirects disabled,
walks a bounded chain, and rejects a `Location` whose origin differs from the
resolver-authorized upstream origin before returning content. The executable
Vite middleware is the Phase 0 model, not production integration. Chromium uses
real 302 responses to prove a same-origin chain succeeds while trusted-to-
untrusted and external-to-trusted chains both receive 409. The messaging browser
test loads its iframe from the URL selected by that same registry-owned guard,
rather than separately testing an unrelated endpoint.

This proof covers HTTP redirect delivery, not arbitrary later script-driven
iframe navigation. Production must not claim the latter is constrained. Classes
without the guarded delivery boundary receive only the sandbox-safe unbounded
ceilings in the table: forwarded content gets scripts/forms, and external content
gets scripts. Neither gets same-origin, clipboard, downloads, popups, modal,
top-navigation, or fullscreen capabilities. Malformed schemes,
userinfo URLs, sibling-domain confusion (`vd.example.test.evil.test`), and
`port-*` lookalikes never become trusted. A forwarded target is privileged only
through its stable Workspace/route registry entry, not because its URL matches
Caddy's hostname pattern.

The production implementation must bind forwarded definitions to the owning
Workspace, an allowed route/port, and the current target generation. It should
also constrain Caddy port routing independently; the iframe policy is defense in
depth and does not make arbitrary localhost port exposure safe.

## Messaging and runtime attachment

Accepted messages require all of:

- exact resolver-derived origin and exact `event.source` window;
- exact version-1 schema with no unknown keys;
- an allowlisted message type with an exact payload schema (`runtime-ready` is
  `{ protocolVersion: 1 }`; `runtime-state` is a non-negative integer heartbeat
  plus `active`/`inactive` visibility), including nested unknown-field rejection;
- matching Panel ID, runtime ID, and target generation; and
- an object payload.

Opaque-origin frames have no authenticated messaging channel under this
contract; `*` is not accepted as identity. A dedicated capability-scoped channel
would need a separate contract if such a plugin requires messaging.

Split View attachment moves only the registry-owned runtime payload under its
exclusive lease. The exact frozen effective policy stays with that runtime;
neither the transient Dockview host nor serialized data can alter it. If a
runtime is recreated rather than leased, it resolves again against current
definitions, so plugin removal and policy tightening apply.

## Executable evidence and decision

`TEST_CASE_M1_4A` proves all five classes, concrete sandbox/allow ceilings,
default denial, ignored persisted claims, plugin removal/tightening, malformed
and host-confusing URLs, redirect non-escalation, Caddy-shaped custom URL
non-attestation, v1 plugin opaque-origin behavior under HTTP redirect and
script/link/form/meta navigation attempts, immutable Split attachment policy,
and exact postMessage
origin/source/schema/Panel/runtime/generation validation. Chromium receives real
iframe-generated `MessageEvent`s before and after moving the same iframe to the
Split host; it rejects a sibling window, a different-origin iframe, stale
generation, unknown type, and malformed nested payload. It also proves the one
runtime element retains the identical policy under its lease. Runtime continuity
itself remains the separate M1.5 lease proof.

**GO:** implement this resolver boundary in M2.3 and replace the base-domain
grant before enabling concurrent Dockview iframe use. The listed forwarded and
external compatibility impacts require explicit product smoke tests; do not
weaken the ceiling merely to preserve accidental legacy privilege.
