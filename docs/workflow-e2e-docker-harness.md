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
