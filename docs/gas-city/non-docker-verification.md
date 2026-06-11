# Non-Docker GC ↔ VK verification paths

This replaces the GC-specific Docker Compose mock harness for the current VD-owned integration work. Docker remains useful for building/running VD itself, but GC ↔ VK bridge verification should not require Docker-in-Docker or a separate GC sidecar.

## Why retire the GC-specific Compose harness

The old harness shape tried to prove GC ↔ VK integration by composing multiple containers around a mock city. In this repo that creates avoidable failure modes:

- nested Docker/socket assumptions vary between local machines, CI, and VK workspaces;
- GC source checkout state can drift from the VD-owned bridge package under `packages/gc-session-vibe`;
- generated city config belongs to VD/Springboard user data, not source-controlled `gascity` files;
- scenario failures become container-orchestration bugs instead of bridge/runtime contract bugs.

The mergeable baseline is therefore: use the installed `gc` binary in the VD container, generated runtime TOML in a user/runtime directory, and deterministic mock VK/provider endpoints only where a real service would add nondeterminism.

## Replacement ladder

Run the lowest rung that covers the changed surface area. Higher rungs can be added to CI once the required binaries/services are available.

| Rung | Scope | Command shape | When to run |
| --- | --- | --- | --- |
| 1. Static VD plugin checks | Type-level integration for Springboard actions/UI and generated config helpers | `npm run check-types` | Any `src/` change |
| 2. Deterministic unit smoke | Local-pack scan/render/sling command construction with no GC process | `pnpm vitest --run src/modules/plugins/gas-city/*.test.ts --config vitest.server.config.ts` | Gas City plugin/helper changes |
| 3. Headless bridge tests | `packages/gc-session-vibe` adoption/session/follow-up behavior against fake VK HTTP server | `go test ./...` from `packages/gc-session-vibe` | Bridge package changes when Go is installed |
| 4. Local-binary city smoke | Generated city runtime plus installed `gc` binary, no Docker sidecar | see checklist below | Runtime config, pack, or session orchestration changes |
| 5. Service smoke | VD container running supervisor + VK API + local `gc`; exercise New Workspace GC-backed modes | scripted scenario smoke | Pre-merge hardening / CI |

## Local-binary city smoke checklist

Use this when `gc` is available in the environment (`command -v gc`). Keep all runtime data under a temp/user data root.

1. Create a temp runtime root, for example:

   ```bash
   export GC_SMOKE_ROOT="$(mktemp -d /tmp/vd-gc-smoke.XXXXXX)"
   ```

2. In the VD UI or a small Springboard action harness, add a local pack ref and render generated config into `$GC_SMOKE_ROOT`.

   Expected files:

   ```text
   $GC_SMOKE_ROOT/city.toml
   $GC_SMOKE_ROOT/pack.toml
   ```

3. Point the Gas City plugin state at the rendered city:

   ```text
   gcBinary = gc
   cityPath = $GC_SMOKE_ROOT
   ```

4. Verify GC can load the city:

   ```bash
   (cd "$GC_SMOKE_ROOT" && gc status)
   (cd "$GC_SMOKE_ROOT" && gc session list --json --state all)
   ```

5. If the city has a safe mock/provider-backed target, dispatch a formula with the same command shape the UI builds:

   ```bash
   (cd "$GC_SMOKE_ROOT" && gc sling <target> <formula> --formula --var smoke_id=local-binary)
   ```

6. Refresh sessions/status in the Gas City panel and record:

   - rendered city path;
   - `gc status` output;
   - sling command and output;
   - resulting session/work item IDs, if any.

## VK-backed service smoke checklist

Use this for the full GC ↔ VK flow once the VD container has `gc` installed and supervisor enabled.

1. Confirm the container runtime:

   ```bash
   command -v gc
   gc version
   supervisorctl status gas-city-supervisor
   ```

2. Configure/generated city state from VD/Springboard data; do not edit the `gascity` checkout.
3. Start a New Workspace in `Worker workflow` mode and confirm:
   - VK workspace is created/opened;
   - GC adopts the initial VK session with `VIBE_ADOPT_WORKSPACE_ID` and `VIBE_ADOPT_SESSION_ID`;
   - Gas City panel refresh shows the worker lane.
4. Start a New Workspace in `Worker + review` mode and confirm:
   - a second VK reviewer session is created in the same workspace;
   - GC adopts both worker and reviewer lanes;
   - reviewer alias receives the kickoff prompt through `gc session submit`.
5. Capture output/logs from the Gas City panel, VK session list, and supervisor logs.

## CI guidance

- Do not add GC-specific Docker-in-Docker as the required path for these checks.
- Make rung 1 and rung 2 required for plugin changes.
- Make rung 3 required for `packages/gc-session-vibe` changes once CI has Go.
- Add rung 4 as the first process-level smoke when CI has an installed `gc` binary.
- Keep any future Compose harness optional and explicitly scoped to container orchestration, not the default proof for GC ↔ VK correctness.
