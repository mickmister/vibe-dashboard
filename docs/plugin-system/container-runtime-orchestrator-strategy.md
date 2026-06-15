# Plugin container runtime orchestration strategy

This document captures the Milestone 6 decision for `vkvw-q2s.31` (MicroVM dockerd container plugin runtime), `vkvw-q2s.13` (microVM-hosted plugin container runtime), and `vkvw-q2s.20` (service-orchestrator options).

## Recommendation

V1 should use a direct, lightweight VD-controlled runtime that targets a Docker daemon inside the plugin microVM. Marketplace plugins never receive the host Docker socket. Container lifecycle commands are planned from signed plugin manifests plus admin-approved effective grants, then executed against the configured microVM `DOCKER_HOST`.

Coolify-style orchestration remains a later evaluation, not a V1 dependency. It may become useful once plugin services need richer app-level dashboards, backups, rolling updates, multi-node scheduling, or user-facing operations beyond install/stage/promote/rollback.

## Trust boundary

1. **VD host app container**
   - Owns plugin discovery, signature verification, capability grant approval, staging/promotion state, and admin audit UI.
   - Holds a client endpoint for the plugin microVM Docker daemon.
   - Must not mount `/var/run/docker.sock` into untrusted plugin code.
2. **Plugin microVM**
   - Runs its own dockerd.
   - Receives only approved images, mounts, ports, env, and secrets.
   - Is the blast-radius boundary for arbitrary binaries and, after a future generated-compose implementation, Docker Compose workloads.
3. **Plugin containers**
   - Run signed, digest-pinned images, preferably published to GHCR by plugin CI.
   - Use only admin-approved filesystem/network/secret grants.
   - Are started/stopped/logged through the microVM dockerd endpoint.

## Compared options

| Option | Pros | Cons | V1 fit |
| --- | --- | --- | --- |
| Direct microVM dockerd commands from VD | Small surface area; easy to test command plans; keeps host socket unavailable; maps cleanly to staged promotion | VD owns lifecycle/retry UX; limited orchestration features | **Recommended V1** |
| Docker Compose inside microVM | Common plugin packaging shape; supports multiple services per plugin; still isolated by microVM dockerd | Compose files can smuggle unapproved volumes, env, ports, capabilities, or host networking unless VD generates/sanitizes them | Deferred: plugin-supplied `composeFile` is rejected until VD can enforce approved grants through generated compose |
| Custom lightweight supervisor in microVM | Stronger control over logs, health, restart policy, and least-privilege wrappers | More code to maintain; duplicates compose/supervisor behavior | Later if direct Docker/Compose becomes too leaky |
| Coolify/control-plane style runtime | Rich logs, deployments, health, rollback UX; familiar service management | Much heavier bootstrap/trust model; may obscure fine-grained grants; too much for agent-driven V1 | Defer to post-V1 evaluation |

## V1 policy

- Container images must be GHCR digest-pinned (`ghcr.io/...@sha256:...`).
- Plugin manifests declare `components.containers[]` separately from Deno backends/bridges.
- Effective grants must approve `hostDocker: microvm-dockerd`; `host-socket` is always rejected.
- Runtime `DOCKER_HOST` must not be empty, `unix://...`, or `/var/run/docker.sock`.
- Filesystem mounts are derived from approved grants only and are limited to `plugin-data` or `workspace` scopes for marketplace plugins.
- Network, env, and secrets shown in admin review are copied from effective grants, not raw manifest requests.
- Logs and health events are recorded per container plan for staging/promotion review.
- Plugin-supplied `composeFile` is rejected for now, even when safely relative, until VD can generate or sanitize compose from approved grants. Safe path validation remains in place so future support fails closed before reading artifact files.

## Migration path

Start with deterministic runtime plans and smoke tests. If plugins begin needing more operational features, add a microVM-local agent/supervisor that accepts the same approved plan format. If that still becomes insufficient, evaluate a Coolify-like control plane as a replaceable orchestrator behind the same manifest/grants/staging contracts.
