# VD integrations env

This package owns the Varlock/Doppler setup for local external Kanban
integration secrets. The app still reads normal `process.env` variables; use
`varlock run` from this package to inject validated values at process start.

## Required local file

Create `.env.integrations` in the workspace root next to this repository
checkout, for example:

```text
/var/tmp/vibe-kanban/worktrees/80ff-vd-kanban-integr/.env.integrations
```

```dotenv
DOPPLER_TOKEN=
```

Then encrypt it before keeping it around locally:

```bash
pnpm --filter @vibe-dashboard/integrations-env exec varlock encrypt --file ../../../.env.integrations
```

`DOPPLER_TOKEN` is marked `@internal`, so it is used by Varlock to fetch Doppler
secrets but is not injected into the VD process by default.

The committed schema imports `../../../.env.integrations` with
`allowMissing=true`. That keeps the encrypted local token outside the app repo
while allowing the package-local Varlock scripts to load it when present.

## Doppler config

The schema loads `@varlock/doppler-plugin` and reads from:

- project: `vibe-dashboard`
- config: `prd_integrations`

The following Doppler secrets are required and injected into VD:

- `JIRA_SITE_HOSTNAME`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `LINEAR_KANBAN_API_KEY`

## Run VD with integration secrets

From the repository root:

```bash
pnpm --filter @vibe-dashboard/integrations-env dev:vd
```

To validate the Doppler-backed environment without starting VD:

```bash
pnpm --filter @vibe-dashboard/integrations-env varlock:load
```

Varlock documentation notes that `varlock run` executes a child process with
resolved and validated variables injected, while `--inject vars` avoids passing
the serialized Varlock config graph blob to long-lived processes. In this
installed Varlock version, `load` supports `--env integrations`, while `run`
loads from the package cwd/schema and does not take `--env`.
