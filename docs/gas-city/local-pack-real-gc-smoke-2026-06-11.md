# Local-pack City Builder smoke against a real `gc` binary — 2026-06-11

Bead: `gc-h5u` — Run local-pack City Builder smoke against real gc binary.

## Environment

The host shell did not have `gc` or `go` installed, so the smoke used a clean `golang:1.25-bookworm` container to install and run a real Gas City binary:

```text
GC_VERSION=1.2.1
```

The generated runtime lived under a container temp directory:

```text
CITY_ROOT=/tmp/vd-gc-smoke.BXrSjr/city
```

## Scenario

The smoke mirrored the VD City Builder flow from `src/modules/plugins/gas-city/city-builder-smoke.test.ts`:

1. Created a local pack with:
   - `pack.toml`
   - `agents/reviewer/prompt.template.md`
   - `formulas/mol-review.formula.toml`
   - `orders/daily-review.toml`
2. Rendered the generated city runtime shape:
   - `city.toml`
   - `pack.toml`
   - `[imports.smoke-pack] source = <local pack path>`
3. Ran `gc status --json` from the generated city root.
4. Ran a real `gc sling` command in dry-run mode using the same command shape the VD UI helper builds.

The dry-run used the qualified imported-pack target that Gas City reported for the imported agent:

```bash
gc sling smoke-pack.reviewer mol-review --formula --var topic=local-pack-city-builder --dry-run
```

## Results

`gc status --json` successfully loaded the generated city and reported:

```json
{
  "schema_version": "1",
  "ok": true,
  "city_name": "Smoke City",
  "running": false,
  "suspended": false,
  "summary": {
    "total_agents": 3,
    "running_agents": 0
  }
}
```

The status command also warned that `tmux` was not installed in the smoke container. That is expected for this minimal `golang` container and did not prevent config loading.

`gc sling --dry-run` resolved the imported reviewer target and formula successfully:

```text
Dry run: gc sling smoke-pack.reviewer mol-review --formula

Target:
  Session config: smoke-pack.reviewer (min=0 max=unlimited)

Formula:
  Name: mol-review

Route command (not executed):
  bd update '<wisp-root>' --set-metadata gc.routed_to=smoke-pack.reviewer

No side effects executed (--dry-run).
```

## Takeaways

- The generated local-pack import TOML is accepted by a real Gas City binary.
- Imported pack agents are addressed by their qualified name, e.g. `smoke-pack.reviewer`, not the unqualified scanner/UI display name `reviewer`.
- A dry-run sling is sufficient for this environment because it proves target/formula resolution without requiring `bd`, `tmux`, or a running supervisor in the minimal container.
- Future UI polish should consider showing or deriving the qualified sling target for imported local-pack capabilities.
