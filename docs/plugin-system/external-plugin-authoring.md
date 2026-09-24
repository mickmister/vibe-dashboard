# External plugin authoring guide

This is the V1 authoring contract for agent-installed VD plugins. The host is sandbox-first: a plugin starts with no sensitive access and only receives capabilities that its manifest requests and an admin approves.

## Artifact layout

A release asset should extract to this shape:

```text
plugin.json
frontend/              # optional compiled iframe assets
bridges/               # optional Deno bridge modules
backend/               # optional Deno backend modules or container support files
```

Plugin-supplied Docker Compose files are intentionally rejected in the current V1 runtime until VD can generate or sanitize a compose model from approved grants. Container plugins should declare digest-pinned single-container units; multi-container compose support remains a future extension once VD can enforce mounts, environment, ports, capabilities, and networking from admin-approved grants only.

The marketplace descriptor points to a signed GitHub release asset. The VD machine downloads it, verifies the sha256 and signature, safely extracts it, writes `verified.json`, and serves frontend assets from the installed artifact. Frontend-only plugin updates can be discovered on browser page loads; server plugin code is planned at server startup and requires a restart to change production code.

## Manifest checklist

`plugin.json` uses `schemaVersion: 1` and should declare:

- `id`, `version`, `displayName`, and `kind`
- `compatibility.vibeDashboard` and `compatibility.pluginApi`
- `components.frontend` for iframe UI routes or Craft surfaces
- `components.denoBridges` for host-mediated, least-privilege data RPC
- `components.denoBackends` for server-side Deno processes loaded at startup
- `components.containers` for arbitrary binaries running only against microVM dockerd
- `components.storage`, `components.secrets`, and `components.healthChecks`
- `requestedCapabilities`, which must match the least privileges needed

Marketplace plugins are intentionally denied by default for:

- VK HTTP API access, especially agent-prompt execution
- host shell access and code-server access
- host Docker socket access
- repo-wide or absolute filesystem access
- direct environment variables
- direct access to other plugins

Use named secrets and scoped storage instead. If a plugin needs Docker, request `hostDocker: "microvm-dockerd"` and pin container images by digest. Container V1 only passes approved secret identifiers into the container metadata; secret values must still flow through the secrets provider. Container host allowlists and ingress-only grants are rejected until VD has enforceable microVM network policy support; use `none`, `egress`, or explicitly approved `ingress-and-egress` for V1 containers.

## UI patterns

1. **Iframe route or Craft surface**: ship compiled HTML/JS under `frontend/`; declare routes and Craft surfaces in the manifest. In this branch the host serves assets under the plugin asset route and applies sandbox/internal-route policy. Serialized postMessage RPC is future work tracked by `vkvw-5h68`, not a live production contract.
2. **Headless bridge plus host UI**: expose Deno bridge methods such as `beads.list`; a trusted host or first-party UI can render data while the bridge runs with Deno read/write/net/run permissions.
3. **Special component iframe**: for UI that must own its own React tree, register a route and render a dedicated iframe for that component rather than trying to serialize React components into the host.

## Staging, promotion, rollback

Install into staging first. The runtime records health checks, smoke-test logs, requested grants, approved grants, and source metadata. Promotion requires an authenticated admin approval with 2FA. Failed or disabled staging records are not promoted unless an explicit admin override is implemented. Production retains recent versions so rollback can repoint to a previously verified version.

## Debugging

- Manifest validation failures list the rejected field or capability.
- Artifact install failures include sha256/signature/extraction errors.
- Deno startup plans include the exact `deno run --no-prompt` permission flags.
- Container runtime diagnostics identify the failing phase: microVM start, dockerd readiness, image pull, container start, health check, or network.
- Frontend asset issues should be debugged by checking `frontend.entry`, health checks, and the served plugin asset URL.

## Reference examples

Reference plugin examples are intentionally omitted from this branch until the runtime supports those contracts end-to-end. Add examples only when their declared bridges, frontend surfaces, or container lifecycle can be installed, validated, and exercised by CI.
