# Plugin iframe sandbox and origin strategy

This note closes `vkvw-654e.3` — "Milestone 3: Prove opaque-origin iframe or separate plugin origin".

## Current finding

The safest default for an untrusted plugin iframe would be an opaque-origin sandbox:

```html
<iframe sandbox="allow-scripts">
```

That mode preserves parent-to-child communication through `iframe.contentWindow.postMessage(...)` and child-to-parent communication through `window.parent.postMessage(...)`, but the current Springboard browser runtime is not ready for it. In an opaque-origin sandbox, browser APIs that require an origin throw security errors. The current Springboard browser entrypoints touch those APIs during startup.

## Springboard opaque-origin blockers observed in this repo

The relevant current usages are in the Springboard package consumed by this prototype:

- `node_modules/springboard/vite-plugin/src/templates/web-entry.template.ts`
  - constructs `BrowserKVStoreService(localStorage)` at module startup.
- `node_modules/springboard/src/platforms/browser/entrypoints/online_entrypoint.ts`
  - constructs `BrowserKVStoreService(localStorage)`.
- `node_modules/springboard/src/platforms/browser/entrypoints/offline_entrypoint.ts`
  - constructs localStorage-backed KV stores.
- `node_modules/springboard/src/platforms/browser/entrypoints/react_entrypoint.tsx`
  - reads `localStorage.getItem('isLocal')`.
- `node_modules/springboard/src/platforms/browser/components/run_local_button.tsx`
  - reads/writes `localStorage`.
- `node_modules/springboard/src/platforms/browser/services/browser_json_rpc.ts`
  - reads `sessionStorage.getItem('ws-client-id')`.

Those accesses explain why the prototype fixture currently uses:

```html
<iframe sandbox="allow-scripts allow-same-origin">
```

## Why `allow-same-origin` is not acceptable for same-origin untrusted plugins

A same-origin iframe with both `allow-scripts` and `allow-same-origin` can effectively escape important parts of the sandbox. That is not a safe default if plugin assets are served from the same origin as the host app.

The prototype keeps this mode only to prove the Springboard-built iframe RPC flow while we harden the runtime.

## V1 fallback: separate plugin origin

Until Springboard supports opaque-origin plugin iframes, the safer production fallback is to serve verified plugin frontend assets from a separate plugin origin, for example:

```text
https://plugins.localhost.invalid/dashboard/plugins/:pluginId/:version/frontend_assets/index.html
```

or a configured loopback port/origin owned by the VD local server:

```text
http://127.0.0.1:<plugin-assets-port>/dashboard/plugins/:pluginId/:version/frontend_assets/index.html
```

In that model the iframe may request `allow-same-origin` as an explicit frontend capability, but its same-origin powers are scoped to the plugin asset origin, not the VD host app origin.

Host policy for separate-origin plugin iframes:

- keep `sandbox="allow-scripts allow-same-origin"` only when the plugin manifest/admin grant allows it,
- use an exact `targetOrigin` for parent-to-iframe `postMessage` when the plugin origin is known,
- continue authenticating messages by registered `WindowProxy`, `pluginId`, `frameId`, nonce, protocol version, and granted RPC methods,
- set plugin asset responses with restrictive defaults such as no credentials, immutable versioned caching, and no host cookies,
- never serve untrusted plugin assets from the same origin with `allow-scripts allow-same-origin`.

## Hardening path to opaque-origin support

To eventually use `sandbox="allow-scripts"` for the default untrusted path, Springboard needs a browser entry mode that:

1. Does not read `localStorage`/`sessionStorage` at module startup.
2. Treats storage as an injected optional capability.
3. Uses in-memory KV storage when origin storage is unavailable.
4. Allows the host to provide required initial context over postMessage RPC.
5. Avoids development-only local toggles such as `isLocal` inside marketplace plugin frames.

Once that exists, the iframe RPC fixture should flip back to `allow-scripts` and the e2e should assert the opaque-origin mode directly.
