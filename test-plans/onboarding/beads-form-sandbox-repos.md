# BeadsForm sandbox repos

Use this harness for BeadsForm manual, unit, and E2E testing when a flow needs
multiple bead-enabled repositories. The harness creates deterministic disposable
repos and prints an environment value that points pending queue scans at those
repos instead of real `~/repos`.

## Create sample repos

```bash
npm run beads-form:sandbox-repos -- --parent-dir "$PWD/.vk-mocked-sandbox/beads-form-sandbox-repos" --reset
```

The command prints JSON including:

```json
{
  "env": {
    "BEADS_FORM_PENDING_PARENT_DIR": "/absolute/path/to/beads-form-sandbox-repos"
  }
}
```

Use that parent directory for BeadsForm queue runs:

```bash
BEADS_FORM_PENDING_PARENT_DIR=/absolute/path/to/beads-form-sandbox-repos npm run dev
```

or for CLI scanning:

```bash
npm run beads-form -- pending --parent-dir /absolute/path/to/beads-form-sandbox-repos
```

## Fixture shape

The harness creates three first-level child repos:

- `beads-form-sandbox-alpha`
  - `bfalpha-pending` with one pending standard DSL form
  - `bfalpha-submitted` with one already-submitted standard DSL form
- `beads-form-sandbox-beta`
  - `bfbeta-pending` with one pending standard DSL form
- `beads-form-sandbox-gamma`
  - `bfgamma-submitted` with submitted-only standard DSL data and no pending
    forms, for verifying that repos without pending forms do not pollute the
    queue

Each bead stores lean standard DSL forms plus `beadFormsSummary`. No generated
`html` or `controls` are persisted.

## Safety rules

- Tests should use a temporary parent directory and clean it up after the run.
- Manual sandbox runs should use a parent under `.vk-mocked-sandbox/`.
- The harness refuses `--reset` unless the target path is clearly sandbox-owned
  by name, such as containing `beads-form-sandbox` or `.vk-mocked-sandbox`.
- Never point `BEADS_FORM_PENDING_PARENT_DIR` at real `~/repos` in automated
  tests.

## Playwright/manual flow

1. Provision the sample repos.
2. Start VD or the mocked VK sandbox with
   `BEADS_FORM_PENDING_PARENT_DIR` set to the printed parent directory.
3. Open `/dashboard/forms`.
4. Verify pending entries from the alpha and beta sample repos.
5. Open a direct form link and submit it.
6. Refresh `/dashboard/forms` and verify completed forms disappear or update
   according to the milestone under test.
