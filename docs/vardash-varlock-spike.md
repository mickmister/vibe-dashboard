# vardash Varlock adhoc launch wrapper spike

Bead: **vkvw-d7ad.2 — Spike Varlock adhoc launch wrapper for vardash**

## Summary

Varlock can be an optional launch-time validation/redaction wrapper for vardash, with vardash remaining the source of truth for values.

Recommended MVP shape:

1. Resolve repo env values from vardash immediately before an explicit repo launch.
2. Generate a temporary `.env.schema` outside repos/worktrees in VD private runtime data.
3. Generate schema metadata only: key name, required flag, sensitivity, optional description/type. Do not write secret or plain values into the schema.
4. Spawn Varlock as argv, not a shell string:
   - command: `varlock`
   - args: `['run', '--path', schemaPath, '--inject', 'vars', '--', ...repoCommandArgv]`
5. Pass resolved vardash values through the spawned process environment. Varlock validates from that environment and forwards individual vars to the child.
6. Keep this wrapper optional. If Varlock is unavailable or validation behavior changes, vardash launch can still run without it once the user/project disables Varlock validation.

## Findings

- Varlock's CLI supports `varlock run -- <command>` for child-process injection/validation.
- `--inject vars` is the right mode for vardash because it injects individual vars only and omits the `__VARLOCK_ENV` serialized config graph blob. Varlock docs warn the default blob can contain resolved sensitive values.
- `varlock load --agent` is safe for diagnostic summaries because sensitive values are redacted; raw `json-full`, `env`, and `shell` outputs are not safe for agent/log contexts.
- Varlock automatically redacts piped/redirected output but passes TTY output through for interactive tools. For VD-managed background processes, prefer `--redact-stdout` only when output is not attached to an interactive TTY; otherwise rely on default auto-detection.
- Varlock supports `@sensitive`, `@required`, and `@type` decorators in `.env.schema`, which is enough for MVP validation/redaction metadata.

Sources:

- Varlock CLI reference documents `run`, `--inject vars`, redaction behavior, and `load --agent`: https://varlock.dev/reference/cli-commands/
- Varlock schema guide documents `.env.schema`, root decorators, config items, and item decorators: https://varlock.dev/guides/schema/
- Varlock secrets guide documents `@sensitive` and secret guardrails: https://varlock.dev/guides/secrets/

## Smoke test performed

Command shape tested with `varlock@1.9.0` via `npm exec --package varlock@1.9.0 -- varlock ...`:

```sh
API_TOKEN=fake-token PORT=3000 \
  npm exec --yes --package varlock@1.9.0 -- \
  varlock run --path /tmp/.../.env.schema --inject vars -- \
  node -e "console.log(process.env.API_TOKEN ? 'token-present' : 'missing', process.env.__VARLOCK_ENV ? 'blob-present' : 'blob-missing', process.env.PORT)"
```

Observed output:

```text
token-present blob-missing 3000
```

This proves the MVP approach can validate/inject values supplied via process env while avoiding the `__VARLOCK_ENV` blob.

## Helper implementation

`src/server/vardash/varlock-spike.ts` includes small, test-covered helpers:

- `generateVardashVarlockSchema(keys)` emits schema metadata only. It omits user-provided descriptions/comments so accidental secret text in descriptions is not copied into generated schema files.
- `buildVarlockRunCommand(input)` returns `{ command, args }` for direct `spawn`/`execFile` use and never builds a shell string.
- `vardashKeyToVarlockSchemaKey(key)` maps store metadata to schema metadata.

## Failure modes and risks

- **Varlock missing from devbox**: when Varlock is requested but the server-controlled runtime policy reports it unavailable, launch fails before spawning with a generic secret-safe `launch_failed` response. Launch still works without Varlock when the user/project does not request it. Do not make Varlock the source of truth.
- **Validation failure**: Varlock exits non-zero before running the child when config is invalid/missing. VD does not expose stdout/stderr/log capture for vardash launches in this scope; status/errors must remain sanitized and secret-safe.
- **TTY redaction limits**: forced redaction on interactive TTY output can fail; background process capture should not use an interactive TTY when redaction is required.
- **Environment inspection**: `--inject vars` avoids `__VARLOCK_ENV`, but the launched process and same-user/root process inspection can still access env vars. This matches the existing vardash threat model.
- **Schema files**: generated schemas are safe to inspect but should still live in VD private runtime data to avoid repo clutter and accidental project coupling. Runtime schema paths and the Varlock binary are server-controlled policy, never client-controlled request fields.
- **Value precedence**: because vardash values are passed in the child environment, launch code must construct a minimal env containing only the repo's resolved env plus required baseline process env.

## Recommendation

Proceed with Varlock as an optional launch wrapper. Use `--inject vars`, generated metadata-only schema files under VD private data, and argv-based spawning. Do not add Varlock as a production resolver/source-of-truth dependency for MVP.
