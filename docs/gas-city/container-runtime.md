# Gas City runtime in the VD container

VD images install Gas City directly as `/usr/local/bin/gc` during image build:

```dockerfile
ARG GASCITY_VERSION="latest"
RUN CGO_ENABLED=0 GOBIN=/usr/local/bin go install github.com/gastownhall/gascity/cmd/gc@"$GASCITY_VERSION" \
    && gc version >/dev/null
```

## Why this exists

Milestone 3 requires GC-first orchestration to run through VK workspaces without a GC-specific Docker-in-Docker sidecar. A local `gc` binary lets VD-managed runtime config and the Gas City panel use the normal `gc` command path from inside the main VD container.

## Build-time controls

- `GASCITY_VERSION=latest` by default.
- Set `--build-arg GASCITY_VERSION=<tag-or-version>` for reproducible images.
- The build verifies the binary by running `gc version`.

## Runtime expectations

- The Gas City plugin's default binary value, `gc`, resolves to `/usr/local/bin/gc`.
- VD/Springboard state still owns generated city config paths and local pack refs.
- Source-controlled files in the `gascity` repo are not mutated by VD flows.

## Docker-in-Docker boundary

The images still include Docker CLI support because unrelated VD/development workflows may need it. GC-specific runtime and smoke paths should prefer the installed `gc` binary and only use Docker-based harnesses when explicitly testing container orchestration behavior.
