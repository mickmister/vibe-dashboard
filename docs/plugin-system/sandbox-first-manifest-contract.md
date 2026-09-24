# Sandbox-first plugin manifest contract

Milestone: `vkvw-q2s.21` — **Milestone 1: Sandbox-first manifest and capability contract**.

The plugin manifest is the source of truth for what a plugin contains and what it asks the host to grant. The runtime is deny-by-default: installing or discovering a plugin does not grant access to sensitive host systems.

## Default denied capabilities

When `requestedCapabilities` is omitted, the host treats every sensitive capability as denied:

- VK HTTP API access: `none`
- host shell access: `none`
- code-server access: `none`
- host Docker access: `none`
- filesystem access: `[]`
- network access: `{ "mode": "none" }`
- direct environment access: `[]`
- secret access: `[]`
- direct plugin-to-plugin access: `[]`

Marketplace plugins cannot request VK prompt-running APIs, host shell, code-server, host Docker socket, repo-wide filesystem access, direct env access, or direct plugin-to-plugin access in V1. They must use narrow Deno bridges, scoped storage, and admin-approved grants instead.

## Requested capabilities vs effective grants

A manifest declares **requests**. The runtime separately stores **effective grants** after admin approval. Unapproved plugins receive denied effective grants even when their manifest requests scoped capabilities.

```text
manifest requestedCapabilities -> admin approval -> effective grants -> runtime enforcement
```

This separation is important for agent-driven installation: an agent may download, verify, validate, and stage a plugin, but production activation requires admin approval for any capability-bearing change.

## North-star Excalidraw shape

Excalidraw is the early low-privilege North Star. It should be implemented as iframe frontend assets plus a narrow Deno storage bridge for a scoped drawings directory.

```json
{
  "schemaVersion": 1,
  "id": "app.excalidraw.canvas",
  "version": "1.0.0",
  "displayName": "Excalidraw",
  "kind": "marketplace",
  "components": {
    "frontend": {
      "kind": "iframe",
      "entry": "frontend/index.html",
      "craftSurfaces": [
        { "id": "canvas", "title": "Excalidraw", "route": "/canvas" }
      ]
    },
    "denoBridges": [
      {
        "id": "drawings-storage",
        "entry": "bridges/storage.ts",
        "methods": ["drawings.list", "drawings.read", "drawings.write"],
        "permissions": {
          "read": [".vibe/plugins/excalidraw"],
          "write": [".vibe/plugins/excalidraw"]
        }
      }
    ],
    "storage": [
      {
        "id": "drawings",
        "scope": "workspace",
        "path": ".vibe/plugins/excalidraw",
        "access": "readWrite"
      }
    ]
  },
  "requestedCapabilities": {
    "filesystem": [
      {
        "scope": "workspace",
        "path": ".vibe/plugins/excalidraw",
        "access": "readWrite"
      }
    ]
  }
}
```

## Built-in and first-party services

Existing services remain built-in/first-party initially, but the manifest is designed so VK can ultimately become a version-swappable service plugin. First-party service manifests may declare broad capabilities explicitly; those privileges do not become marketplace defaults.

VK and similar single-active-version services should be staged, health-checked, promoted, and rolled back through the same installer model, with GitHub release assets as the production source.

## Agent-driven verified installation and discovery

Milestone 2 adds a host-side installer/discovery path for agent-driven staging:

1. An agent proposes a plugin artifact descriptor with `pluginId`, `version`, source URL, checksum, and signature.
2. The host downloads the artifact, verifies checksum and signature, and safely extracts a `plugin.json` rooted tarball into an immutable version directory.
3. The extracted manifest is validated with the sandbox-first contract before the install is written as verified.
4. Discovery scans installed versions on demand and does not execute plugin code. Duplicate versions are resolved deterministically by selecting the highest version for each plugin id. Disabled selected versions are reported separately and not activated.
5. Frontend discovery returns the extracted frontend asset root and entry asset path so later page-load routing can observe newly installed frontend plugins without requiring a server restart.

Unsafe artifacts fail closed before activation: checksum mismatch, signature failure, tar traversal/link entries, malformed manifests, manifest id/version mismatch, and broken installed directories all surface as installer errors or discovery diagnostics.
