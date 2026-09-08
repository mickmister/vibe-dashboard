# Fallow Analysis Report

Date: 2026-07-28

This report summarizes the repository analysis performed with `npx fallow` and the configuration added in `.fallowrc.json`.

## Configuration Added

The new `.fallowrc.json` config is intended to make Fallow understand the current shape of this repository instead of treating only the default app/library surfaces as reachable.

Key choices:

- Added app, Vite, Vitest, Playwright, CLI, plugin orchestrator, Storybook story, e2e, and script entry points.
- Declared the root package and `packages/*` as workspaces.
- Ignored Springboard peer/runtime dependencies that are intentionally declared for generated runtime entry points: `@hono/node-server`, `crossws`, `immer`, and `rxjs`.
- Excluded tests, stories, e2e specs, and imported migration output from health and duplication scoring.
- Set `audit.gate` to `new-only`, so review checks can fail only on newly introduced findings.

## Commands Run

```bash
npx fallow config --format json --pretty
npx fallow dead-code --format markdown
npx fallow health --hotspots --targets --format markdown
npx fallow dupes --format markdown
npx fallow flags --format markdown
npx fallow audit --base HEAD --format markdown
npx fallow security --format human
```

## Before and After

Before adding config, the default `dead-code` scan reported 213 issues, including 68 unused files. Many of those were tests, CLI scripts, plugin files, and other real project surfaces that Fallow did not know were entry points.

After adding config:

| Check | Result |
| --- | ---: |
| Dead-code issues | 90 |
| Unused files | 0 |
| Unused exports | 72 |
| Unused type exports | 5 |
| Unused class members | 8 |
| Unused dev dependencies | 1 |
| Unlisted dependencies | 1 |
| Test-only production dependency findings | 2 |
| Feature flags | 0 |
| Circular dependencies | 0 |

The health scan also became less noisy:

| Metric | Before | After |
| --- | ---: | ---: |
| Total LOC in health scope | 50,262 | 36,561 |
| Dead files | 38.4% | 0.0% |
| Dead exports | 16.4% | 10.1% |
| Average maintainability | 82.4 | 89.2 |
| Hotspots | 2 | 2 |
| Unused deps | 5 | 1 |

## Review Workflow

For pull requests, use:

```bash
npx fallow audit --base origin/main --format markdown
```

For a local check scoped to only the last commit, use:

```bash
npx fallow audit --base HEAD~1 --format markdown
```

For a non-blocking reviewer brief:

```bash
npx fallow audit --base origin/main --brief --format markdown
```

The configured audit gate is `new-only`, so inherited findings are still visible but do not fail the check. In the validation run for the config change itself, `npx fallow audit --base HEAD --format markdown` passed and reported no issues in the changed file. It also showed three inherited package findings excluded from the gate.

## Important Remaining Findings

### Dependency Hygiene

Fallow still reports these package findings:

- `@heroui/drawer` is directly imported in `src/components/ExternalJiraBoardView.tsx` and its test, but is not listed directly in `package.json`.
- `@better-auth/cli` appears unused.
- `@tailwindcss/vite` appears to be used only by `vite.config.ts`, so it likely belongs in `devDependencies`.
- `react-dom` is reported as test-only production usage, but this should be checked carefully because React/Springboard runtime behavior may still need it as a production dependency.

### Duplication

Duplication remains the largest structural signal: 66 clone groups, 4,843 duplicated lines, 13.4% duplication.

The highest-value duplication finding is a 1,243-line clone between:

- `src/index.tsx:530-1768`
- `src/modules/MainUIShellModule.tsx:176-1418`

This looks like a migration or parallel-module artifact. It should be resolved by choosing one owner for the shared shell/module behavior or extracting shared UI/session logic.

Other useful duplication targets:

- Shared API/type shapes between `packages/plugin-api/src/index.ts` and `src/modules/plugins/vibe-dashboard/types.ts`.
- Repeated Vibe Agent client code across `scripts/vibe-agent/cli/vk-service.ts` and `scripts/vibe-agent/core/client.ts`.
- Repeated URL/origin handling across `src/components/IframePanel.tsx`, `src/lib/originTrust.ts`, and `src/modules/plugins/vibe-dashboard/craft-surfaces.ts`.
- Repeated view logic between `src/components/UnifiedTabView.tsx` and `src/components/WorkspaceContentView.tsx`.

### Hotspots and Complexity

The top hotspots after configuration are unchanged, which means they are genuine maintenance risk rather than entry-point noise:

| File | Score | Notes |
| --- | ---: | --- |
| `src/components/ExternalJiraBoardView.tsx` | 86.5 | 1,358 LOC, 26 recent commits, accelerating |
| `src/server/external-integrations/boardRoutes.ts` | 74.7 | 1,022 LOC, 19 recent commits, accelerating |
| `src/server/external-integrations/jiraAdapter.ts` | 27.5 | 1,125 LOC, 12 recent commits, accelerating |
| `src/index.tsx` | 17.6 | Large stable shell surface |
| `src/modules/MainUIShellModule.tsx` | 14.6 | Large stable shell surface |

Top refactoring candidates from Fallow:

- Split `src/server/external-integrations/boardRoutes.ts`.
- Split `src/components/ExternalJiraBoardView.tsx`.
- Extract `fetchBoardIssuePages` from `src/server/external-integrations/jiraAdapter.ts`.
- Extract `WorkspaceShell` and `performWorkspaceSearchAdd` from `src/components/WorkspaceShell.tsx`.
- Extract `WorkspaceRoute` from `src/modules/MainUIShellModule.tsx`.
- Extract `loadSessionNav` from `src/sessionState.ts`.
- Extract `Sidebar` from `src/components/Sidebar.tsx`.

### Dead Exports

After configuration, unused-file noise is gone, but Fallow still reports 72 unused exports and 5 unused type exports.

Notable areas:

- `src/components/ExternalJiraBoardView.tsx` exports many internal-looking React components.
- `src/server/plugin-admin-routes.ts` has three unused exported helpers.
- `src/server/external-integrations/config.ts` and `database.ts` expose values that may not need to be public.
- `scripts/vibe-agent/*` still has unused exported helpers, especially in config, context, session-file, and nudge modules.

These should be reviewed with targeted traces before deleting anything:

```bash
npx fallow dead-code --trace <file>:<export>
npx fallow dead-code --type-aware --symbol-impact <file>:<export>
```

### Security Candidates

`npx fallow security --format human` reported 93 unverified candidates. These are not confirmed vulnerabilities.

The most important categories to review:

- Legacy Vibe Agent CLI path traversal candidates in `scripts/vibe-agent/legacy-cli/vibe-agent.ts`.
- Legacy Vibe Agent CLI secret or PII logging candidates in the same file.
- Dynamic fetch destination candidates in client/runtime code.
- Raw SQL execution in migration code.
- Repo path handling in external integration board routes.

Because the config now marks the legacy CLI as a real entry point, several findings that were previously dead-code-adjacent are now considered reachable. That is a useful signal if the legacy CLI is still shipped through `bin/vibe-agent`; otherwise, the next cleanup should remove or retire that entry.

## Recommended Next Steps

1. Add `npx fallow audit --base origin/main --format markdown` to PR CI in advisory mode.
2. Fix package hygiene first, especially `@heroui/drawer` and `@tailwindcss/vite`.
3. Decide whether `bin/vibe-agent` should still point at `scripts/vibe-agent/legacy-cli/vibe-agent.ts`.
4. Address the 1,243-line clone between `src/index.tsx` and `src/modules/MainUIShellModule.tsx`.
5. Split the Jira board frontend/server hotspot files along route/API/UI boundaries.
6. Use targeted Fallow traces before removing exports.
