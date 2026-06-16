# Plugin UI rendering strategy

This decision belongs to `vkvw-nzv5.2` — "Compare plugin iframe UI rendering strategies".

## Recommendation

Use two explicit trust tiers:

1. **Default marketplace plugins run isolated** in sandboxed iframes and communicate with the host using JSON-only postMessage RPC.
2. **Trusted host-script plugins are an elevated mode** that can register real React components in the host process, but must be shown as a high-risk install requirement to admins before enablement.

The default marketplace path should not serialize or import React components from untrusted plugins.

## Why React components do not cross the iframe boundary well

React components are executable JavaScript closures with hooks, module imports, refs, and event handlers. They are not a durable or safe serialization format. Treating plugin components as data would either fail for normal React features or become equivalent to executing plugin code in the host.

## Default UI mechanisms

### 1. Data-driven host rendering

Plugins register JSON contributions such as menu items, commands, forms, tab presets, and panels. The host renders those contributions with trusted React components.

Pros:

- Strong sandbox boundary.
- Easy admin capability review.
- Consistent host UI and accessibility.
- Straightforward to test and version.

Cons:

- Plugin authors are limited to host-supported schemas.
- Rich custom UI requires another mechanism.

This is the recommended V1.

### 2. Plugin-rendered iframe views

Plugins can expose iframe-rendered views for richer UI. The host creates an iframe for the plugin view and passes context over RPC.

Pros:

- Plugin authors can use React or any frontend framework inside their own iframe.
- Isolation is preserved.
- No React component serialization required.

Cons:

- More lifecycle, focus, theme, and sizing work.
- More browser overhead when many plugin views are visible.

This is the recommended escape hatch for rich UI.

### 3. Trusted host-script mode

Trusted plugins can request permission to run JavaScript in the host context and register React components directly.

Pros:

- Best developer ergonomics.
- Full Springboard/React integration.
- No iframe overhead.

Cons:

- Equivalent to granting host app code execution.
- Can access host-origin browser resources and app internals.
- Not appropriate for untrusted marketplace plugins.

Admins must see this as a distinct high-risk capability before installation or enablement.

## Sandbox default

Default untrusted frontend plugin iframes should start with:

```html
<iframe sandbox="allow-scripts">
```

Parent-to-iframe communication uses `iframe.contentWindow.postMessage(...)`. Iframe-to-parent communication uses `window.parent.postMessage(...)`. Without `allow-same-origin`, the iframe has an opaque origin, so the host must authenticate messages using the registered `contentWindow`, frame id, nonce, plugin id, and granted capabilities rather than `event.origin`.

The current Springboard browser runtime touches origin-scoped APIs such as
`localStorage`, so the checked-in fixture uses `allow-same-origin` to prove the
RPC path with Springboard-built host and iframe apps:

```html
<iframe sandbox="allow-scripts allow-same-origin">
```

That combination is not an acceptable default for untrusted same-origin plugin
assets because browsers warn that a same-origin iframe with scripts can escape
the sandbox. Before shipping untrusted marketplace plugins, either harden
Springboard to run in an opaque-origin iframe, serve plugin frontend assets from
a separate plugin origin, or expose `allow-same-origin` only as an explicit
admin-approved frontend capability.

## Archived prototype coverage

The iframe RPC prototype is archived at `notes/plugin-plans/plugin-iframe-rpc-prototype`. It is not part of the active workspace or CI on this branch because the merge-ready runtime currently focuses on first-party service orchestration. The archived prototype explored:

- protocol version validation,
- JSON-only payload validation,
- iframe source-window and nonce checks,
- parent-to-iframe postMessage via the registered WindowProxy,
- data-driven contribution registration,
- rejection of unsupported RPC methods.
