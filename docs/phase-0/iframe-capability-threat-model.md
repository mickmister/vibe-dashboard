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
messages fail closed.

| Class | Sandbox ceiling | Permissions Policy ceiling |
| --- | --- | --- |
| `vd-built-in` | scripts, same-origin, forms, modals | clipboard read/write, fullscreen |
| `vk-built-in` | scripts, same-origin, forms, modals | clipboard read/write, fullscreen |
| `installed-plugin` | scripts; manifest-requested same-origin | manifest-requested fullscreen |
| `forwarded-project` | scripts, forms | none |
| `external-url` | scripts | none |

All classes deny downloads, popups, popup escape, and top navigation by user
activation. A false value is meaningful: omission from the generated `sandbox`
or `allow` attribute is the denial. Plugin manifests can request only within the
VD ceiling; removal or tightening takes effect on the next trusted resolution.
Production must retain the existing prohibition on combining scripts and
same-origin for host-origin plugin assets.

The built-in ceilings preserve the current VK/code-server clipboard, form,
modal, and fullscreen behavior. Forwarded project servers deliberately lose
ambient clipboard, same-origin, popup, modal, and fullscreen privilege until a
separately reviewed, stable route definition proves that functionality requires
a narrower explicit grant. This is a visible compatibility impact, not a silent
change. External URLs likewise tighten from the current forms/popups/modals and
fullscreen fallback to scripts only.

## Navigation, host confusion, and Caddy threats

Trusted classes may navigate only within their resolver-returned origin.
External URLs may follow HTTP(S) redirects, but retain the external provenance
and capabilities even when the destination resembles VD. Malformed schemes,
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
- an allowlisted message type;
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
non-attestation, immutable Split attachment policy, and exact postMessage
origin/source/schema/Panel/runtime/generation validation. Chromium additionally
uses a real iframe `WindowProxy`, rejects a sibling source, and proves the
single runtime element keeps the identical effective policy when attached to a
Split host. Runtime continuity itself remains the separate M1.5 lease proof.

**GO:** implement this resolver boundary in M2.3 and replace the base-domain
grant before enabling concurrent Dockview iframe use. The listed forwarded and
external compatibility impacts require explicit product smoke tests; do not
weaken the ceiling merely to preserve accidental legacy privilege.
