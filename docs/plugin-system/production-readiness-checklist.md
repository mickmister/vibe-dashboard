# Plugin production-readiness checklist

Use this checklist before treating external agent-installed plugins as production ready.

## Security

- [ ] Every plugin artifact is fetched from a pinned GitHub release asset URL.
- [ ] sha256 and Mattermost-style detached signature verification pass before extraction.
- [ ] Tar extraction rejects path traversal, links, oversize files, and too many files.
- [ ] Marketplace plugin manifests default to no VK HTTP API, host shell, code-server, host Docker socket, repo-wide filesystem, env, or plugin-to-plugin access.
- [ ] Admin approval shows requested capabilities and approved grants separately.
- [ ] Backend Deno bridges run with explicit `--allow-*` flags and `--no-prompt`.
- [ ] Container plugins use only microVM-local dockerd, digest-pinned GHCR images, and no host Docker socket.
- [ ] Secrets flow through a secrets provider/Varlock-style reference rather than raw env grants.

## Runtime and observability

- [ ] Staging install runs health checks and smoke tests before promotion.
- [ ] Logs are visible for install, Deno startup, container lifecycle, health checks, promotion, and rollback.
- [ ] Runtime diagnostics include microVM, dockerd, image pull, compose, network, and health-check phases.
- [ ] First-party services expose their broad privileges in a separate audit view from marketplace plugins.
- [ ] Boot-critical first-party services are not admin-removable, though version swaps can still be staged and rolled back.

## Rollback and compatibility

- [ ] Production keeps the latest three verified versions per plugin/service where applicable.
- [ ] Rollback can repoint to a retained version without re-downloading artifacts.
- [ ] Compatibility ranges for VD and the plugin API are checked before promotion.
- [ ] Single-instance services such as VK have an explicit swap-back path to a stable version.

## CI and acceptance

- [ ] `npm run check-types` passes.
- [ ] `npm run test:server` passes.
- [ ] Reference plugin manifests, build, and e2e checks pass.
- [ ] Deno bridge smoke tests pass.
- [ ] Container runtime isolation smoke tests pass.
- [ ] Staging/promotion e2e tests pass.
- [ ] The full `Dockerfile.vkvd` image builds with the CI runtime stub.

## Future orchestrator evaluation

Coolify or a similar orchestrator can be evaluated after the direct VD-controlled runtime is stable. Keep this later because V1 needs agent-driven installation, deterministic approval, staged promotion, and rollback more than a full PaaS UI. If revisited, evaluate whether each plugin container can run in its own microVM with clear logs, version switching, secrets integration, and no additional path to the VK HTTP API or host shell.
