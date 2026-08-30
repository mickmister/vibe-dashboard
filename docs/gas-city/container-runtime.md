# Gas City runtime in the VD container

VD images install Gas City directly as `/usr/local/bin/gc` during image build:

```dockerfile
ARG GASCITY_VERSION="v1.4.1"
RUN CGO_ENABLED=0 GOBIN=/usr/local/bin go install github.com/gastownhall/gascity/cmd/gc@"$GASCITY_VERSION" \
    && gc version >/dev/null
```

They also compile the VD-owned GC exec-provider bridge as
`/usr/local/bin/gc-session-vibe` from `packages/gc-session-vibe`.

## Why this exists

Milestone 3 requires GC-first orchestration to run through VK workspaces without a GC-specific Docker-in-Docker sidecar. A local `gc` binary lets VD-managed runtime config and the Gas City panel use the normal `gc` command path from inside the main VD container.

## Build-time controls

- `GASCITY_VERSION=v1.4.1` by default for reproducible images.
- Set `--build-arg GASCITY_VERSION=<tag-or-version>` to intentionally test a newer Gas City release or commit.
- The build verifies the binary by running `gc version`.

## Runtime expectations

- The Gas City plugin's default binary value, `gc`, resolves to `/usr/local/bin/gc`.
- The pinned release supports released Gas City commands such as `gc sling`,
  formulas, convoys, hooks, and supervisor flows. VD must not depend on
  unreleased commands such as proposed convoy ready-expansion helpers.
- VD may coordinate multiple ready workspace beads by calling released
  `gc sling <target> <bead> --on <formula>` once per bead under a VD lock; the
  installed `gc` binary still owns each workflow after launch.
- Generated Gas City config should reference the VD-owned bridge with
  `GC_SESSION=exec:/usr/local/bin/gc-session-vibe` when a VK-backed provider is
  needed.
- `supervisord` starts `gc supervisor run` as `vkuser` through the `gas-city-supervisor` program.
- Set `ENABLE_GAS_CITY_SUPERVISOR=false` to disable the long-lived GC control plane for debugging or images that only need the CLI.
- The supervisor uses `GC_HOME=/home/vkuser/.gc` and `XDG_RUNTIME_DIR=/var/tmp/vibe-kanban/gc-runtime`, both owned by `vkuser`.
- VD/Springboard state still owns generated city config paths and local pack refs.
- Source-controlled files in the `gascity` repo are not mutated by VD flows.

## Docker-in-Docker boundary

The images still include Docker CLI support because unrelated VD/development workflows may need it. GC-specific runtime and smoke paths should prefer the installed `gc` binary and only use Docker-based harnesses when explicitly testing container orchestration behavior.

See [Non-Docker GC ↔ VK verification paths](./non-docker-verification.md) for the replacement smoke ladder and local-binary checklists.
