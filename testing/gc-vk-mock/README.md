# GC ↔ VK mock compose harness

This harness exercises the relocated `gc-session-vibe` bridge end to end using:

- **Gas City main** cloned inside Docker
- the upstream **gastown** pack as a mounted source
- a VD-owned **vk-mock** pack for a deterministic smoke session template
- local **Vibe Kanban** built from `../Vktest`
- **AIMock** as the OpenAI-compatible mock model backend

## What it tests

The smoke flow proves:

1. Gas City can create a session from a city that imports the gastown pack
2. the city uses the external `gc-session-vibe` exec provider from this repo
3. the bridge creates a VK workspace and execution
4. OpenCode inside VK reaches AIMock through a pinned provider config
5. `gc session peek` sees deterministic initial and follow-up responses

## Run it

From `vibe-kanban-vscode-web/`:

```bash
bash ./testing/gc-vk-mock/scripts/run-compose.sh
```

Or directly with Docker Compose:

```bash
docker compose -f ./testing/gc-vk-mock/docker-compose.yml up --build --abort-on-container-exit --exit-code-from smoke
```

The harness tears the stack down automatically in the wrapper script.

## Layout

- `docker-compose.yml` — stack definition
- `docker/` — custom VK and smoke-runner images
- `config/opencode.json` — OpenCode provider config pointing at AIMock
- `fixtures/` — deterministic AIMock fixtures
- `packs/vk-mock/` — tiny test pack that adds the `smoke` named session template
- `scripts/smoke.sh` — end-to-end smoke automation

## Notes

- The test city keeps **all harness-owned assets in VD** and does **not** modify the GC repo.
- The city imports the upstream gastown pack via a symlink into the cloned GC main checkout.
- The smoke city uses `[beads] provider = "file"` so the harness does not depend on `bd`.
