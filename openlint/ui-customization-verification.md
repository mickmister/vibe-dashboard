# OpenLint UI customization fence verification

Date: 2026-09-01

Environment policy:

- `/home/vkuser/.config/openlint/openlint.yaml`
- Environment policy commit: `142b47b Add OpenLint environment policy`

Target manifest:

- `openlint/ui-customization-targets.json`
- Current migrated pass/fail target: `src/components/spaces-overview`

## Commands

Run from the repo root:

```sh
npm run lint:tsx-view-boundary:migrated -- --json
npm run lint:ui-fences:migrated -- --json
npm run lint:tsx-view-boundary:changed -- --json
npm run lint:ui-fences:last-commit -- --json
```

These scripts intentionally use `ol` and do not pass `--policy-dir`; OpenLint
loads the canonical environment policy by default.

## Current verification result

Latest local verification against `src/components/spaces-overview`:

| Command | Status | Findings | Errors | Notes |
| --- | --- | ---: | ---: | --- |
| `npm run lint:tsx-view-boundary:migrated -- --json` | success | 0 | 0 | Migrated SpacesOverview TSX files satisfy view-boundary fences. |
| `npm run lint:ui-fences:migrated -- --json` | success | 0 | 0 | Migrated SpacesOverview TSX files satisfy UI customization fences. |
| `npm run lint:tsx-view-boundary:changed -- --json` | success | 0 | 0 | Clean changed-file flow skips file-oriented integrations when no TSX files are changed. |
| `npm run lint:ui-fences:last-commit -- --json` | success | 0 | 0 | Latest-commit patch flow produced no UI-fence regressions. |

Expected current findings for the migrated target are therefore zero. Any new
finding from the migrated scripts should be treated as a regression or as a
signal that the target manifest/policy needs an intentional update.
