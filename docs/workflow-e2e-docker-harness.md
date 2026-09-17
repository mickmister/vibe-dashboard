# Workflow E2E Docker harness

Workflow orchestration E2E tests must run in Docker, not directly on the local
host. The first smoke harness validates the VK deterministic scripted QA
executor from inside a disposable Rust container and runs the test command via
`docker exec`.

```bash
scripts/workflow-e2e-docker-smoke.sh
```

Useful overrides:

- `VK_REPO_DIR=/path/to/vibe-kanban` — VK checkout to mount into the container.
- `WORKFLOW_E2E_RUST_IMAGE=rust:1.90-bookworm` — Rust test image.
- `WORKFLOW_E2E_CONTAINER_NAME=name` — deterministic container name for local debugging.

The harness is intentionally minimal. Later VD scanner/scheduler/fan-in E2E
slices should extend this Docker-only pattern with a purpose-built compose stack
or dedicated test runner container, but should continue to execute workflow E2E
commands through Docker rather than running them on the host.

## Workflow UI Playwright E2E

The durable workflow UI acceptance test uses a Docker-only harness that starts a
same-origin VD+VK qa-mode sandbox inside a container and runs Playwright from
that same container via `docker exec`:

```bash
npm run test:e2e:vk-workflows-docker
```

The harness mounts both local checkouts read-only, copies them into
container-local writable directories, installs dependencies in the container,
resets the seeded qa-mode fixture, starts VK with `--features qa-mode`, lets VD
self-provision the VK terminal execution webhook, and runs the committed tests in
`tests/e2e/features/8b79-vd-workflows/`.

Useful overrides:

- `VK_REPO_DIR=/path/to/vibe-kanban` — VK checkout to mount read-only.
- `WORKFLOW_E2E_PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.58.2-noble` — runner image.
- `WORKFLOW_E2E_HOST_PORT=50005` — optional host port published for debugging.
- `WORKFLOW_E2E_KEEP_CONTAINER=1` — leave the container running after failure.

Do not run the workflow acceptance E2E directly on the host as the official gate;
use the Docker harness so qa-mode workflow execution, Playwright, and generated
build artifacts stay container-local.
