# ADR 0002: Gas City-backed VD Workflows architecture

Status: proposed / decision-review

Date: 2026-09-01

Decision beads:

- `vibe-kanban-vscode-web-1q0x` — ADR for Gas City-backed VD Workflows architecture
- `vibe-kanban-vscode-web-ct01` — Discuss Gas City workflow-system integration handoff

Reference inputs:

- Donor branch: `origin/vk/42a2-vd-gas-city-plug`
- Donor handoff: `notes/GAS-CITY-WORKFLOWS-BRANCH-HANDOFF.md` on the donor branch
- Donor package: `packages/gc-session-vibe/`
- Donor plugin reference: `src/modules/plugins/gas-city/`
- Public Gas City project: <https://github.com/gastownhall/gascity>

## Context

The `vk/8b79-vd-workflows` branch built a VD-native workflow system with
workflow creation, launch, monitoring, CLI launch/callbacks, activity snapshots
and websocket/polling clients, typed XML action results, beads-form output
contracts, workflow role/prompt/skill libraries, batch runs, and sequential
bead-driven meta-workflows.

The next product direction is to align VD Workflows with Gas City and Beads. The
user's current decision is stronger than "Gas City as optional plugin": the VD
Workflows product should use/require Gas City for durable orchestration, while
VD/VK should preserve provider-shaped boundaries for testability, packaging,
product-safe read models, and future provider replacement if needed.

The donor branch `origin/vk/42a2-vd-gas-city-plug` contains a working/reference
Gas City integration prototype, but its handoff explicitly says not to treat the
donor branch as the long-term integration base. The workflows branch remains the
base because it contains the workflow UX, callback/activity stack, and generic
workflow primitives that should wrap or surface Gas City-backed work.

Gas City's public release stream matters. The handoff pinned the donor runtime
contract to released `gc v1.4.1`, whose release notes describe run-centered APIs,
session lifecycle convergence, formula v2 fan-out/drain/finalization behavior,
and a resilient beads persistence boundary. The current architecture must depend
only on pinned released behavior unless a later form explicitly approves an edge
or commit-pinned experiment.

## Decision

VD Workflows will become **Gas City-backed by default/required for production
workflow orchestration**, with Gas City/Beads authoritative for workflow state.
VD/VK will own the user-facing workflow experience, workspace/session UI,
callback/activity surfaces, bridge packaging, generated runtime config, and
product-safe read models.

We will keep an internal generic provider seam, but this seam is an architecture
boundary, not a product promise that workflows are equally useful without Gas
City. The first production provider is Gas City.

## Ownership and authority

| Layer | Owns | Must not own |
| --- | --- | --- |
| VD Workflows product | Workflow UX, launch affordances, library/editor concepts, product-safe monitoring, callback/activity integration, generated Gas City pack/config from VD-authored workflow desires | Authoritative Gas City workflow advancement, formula execution, retry/fan-out/drain semantics |
| VK | Workspaces, sessions, executor/model runtime, foreground chat/activity UI, follow-up delivery primitives | Gas City formula semantics or beads truth |
| Gas City | Formulas, orders, graph.v2 execution, fan-out/fan-in, drain/finalization, hooks/work queries, session orchestration, health patrol | VD/VK UI state and workspace creation UX |
| Beads | Durable work truth, dependencies, readiness, metadata, workflow/source-bead links, result notes | Transient dashboard-only view state |
| VD caches/read models | Rebuildable product summaries, UI links, temporary projections, diagnostic pointers | Decisions about whether a GC workflow is running/blocked/complete |

Authority rule: if a field changes workflow outcome, readiness, routing, or
completion, it belongs to Gas City/Beads. VD may cache it only as a rebuildable
read model.

## Required-Gas-City stance

The VD Workflows plugin should not present Gas City as an optional advanced add-on
for the main product path. Instead:

- Product copy should say workflows are powered by Gas City/Beads where relevant,
  but hide `gc sling`, formula, convoy, hook, or order jargon from normal users
  until needed.
- Development/test seams should still be provider-shaped so unit tests can use
  fake providers and so Gas City process failures are handled cleanly.
- Product unavailable states should say the workflow engine is not configured or
  not healthy, rather than silently falling back to static/demo data.
- Storybook/tests may use static fixtures, but staging/product routes must not
  show fake workflow state.

## Provider contract

The provider contract is server-side and typed. It is the bridge between VD
Workflow UX and a Gas City-backed orchestration engine.

```ts
interface WorkflowOrchestratorProvider {
  providerId: string;
  label: string;
  version: string;

  getHealth(context: ProviderContext): Promise<ProviderHealth>;
  listCapabilities(context: ProviderContext): Promise<ProviderCapability[]>;
  listLaunchTargets(context: ProviderContext): Promise<ProviderLaunchTarget[]>;
  listFormulaChoices(context: ProviderContext): Promise<ProviderFormulaChoice[]>;

  validateLaunch(input: ProviderLaunchRequest): Promise<ProviderValidationIssue[]>;
  launchSourceWorkflow(input: ProviderLaunchRequest): Promise<ProviderLaunchResult>;

  getWorkflow(ref: ProviderWorkflowRef): Promise<ProviderWorkflowReadModel | null>;
  listWorkflows(context: ProviderListContext): Promise<ProviderWorkflowReadModel[]>;
  getActivity(context: ProviderActivityContext): Promise<ProviderActivitySnapshot>;
}
```

### Provider context

```ts
type ProviderContext = {
  workspaceId: string;
  vkWorkspaceId?: string;
  vkSessionId?: string;
  currentBeadIds?: string[];
  userId?: string;
};
```

### Launch request

The first supported launch primitive is explicit single source-bead launch:

```ts
type ProviderLaunchRequest = {
  workspaceId: string;
  sourceBeadId: string;
  target: string;
  formula: string;
  vars: Record<string, string>;
  nudge: boolean;
  idempotencyKey: string;
};
```

For Gas City this maps to the released command:

```bash
gc sling <target> <source-bead-id> --on <graph.v2 formula>
```

Provider implementation may shell out to the pinned `gc` binary on the server,
but raw command lines, host paths, env values, and stdout/stderr must not be
shown in normal UI or ordinary API read models.

### Launch result

```ts
type ProviderLaunchResult = {
  providerId: "gas_city";
  workflowRef: {
    sourceBeadId: string;
    rootBeadId?: string;
    workflowId?: string;
    formula: string;
    target: string;
  };
  status: "accepted" | "already_running" | "blocked";
  summary: string;
  productLinks: Array<{ label: string; href: string }>;
  diagnosticsRef?: string;
};
```

`diagnosticsRef` is not a primary UI field. It may point to a product-safe
advanced route/log artifact later.

### Read model

```ts
type ProviderWorkflowReadModel = {
  providerId: "gas_city";
  workflowRef: ProviderWorkflowRef;
  sourceBead: { id: string; title: string; status: string };
  status: "pending" | "running" | "waiting" | "blocked" | "completed" | "failed" | "unknown";
  currentOwner?: string;
  currentStage?: string;
  nextAction?: string;
  progress?: { total: number; completed: number; running: number; blocked: number };
  updatedAt?: string;
  productLinks: Array<{ label: string; href: string }>;
  warnings: string[];
};
```

Every provider-provided string must be capped and scrubbed before entering normal
UI/read-model output.

## Gas City command allowlist

First implementation slice may use only pinned released commands needed for
inspection and explicit launch. Proposed initial allowlist:

- `gc version`
- `gc formula show --json <formula>` for contract validation
- `gc sling <target> <source-bead-id> --on <graph.v2 formula>`
- `gc session list --json` / equivalent released session inspection
- `gc convoy status --json <convoy-id>` only for display/filtering, not authority
  expansion
- `gc events --follow` only for later non-busy polling/watcher slices

Not allowed in first code slice:

- `gc convoy expand-ready ...` unless released and explicitly version-pinned in a
  later decision
- generic `gc` passthrough from the browser
- arbitrary shell or raw `bd` commands from workflow JSON/UI
- VD-side formula graph application or workflow-step advancement
- hidden scheduler/order execution

## Port order

User-approved order:

1. **Docs/constraints.** Port/capture architecture constraints and validation
   expectations from the donor branch.
2. **Bridge package.** Port `packages/gc-session-vibe/` and make Go tests pass.
3. **Provider seam.** Add typed server-side Gas City provider contract and fake
   provider tests.
4. **Explicit launch.** Wire single-bead `gc sling ... --on graph.v2` launch via
   provider, with product-safe read model and idempotency.
5. **UI/fanout.** Add product UI and then ready-bead fanout after single launch
   is proven.

Do not port the donor UI wholesale. Learn from it, but rebuild product UX around
current Workflows command-center, run/story pages, activity/callbacks, and role
library concepts.

## Autogenerated Gas City pack from VD workflows

Longer-term product direction: VD workflow configurations should become
high-level user intent that generates a Gas City pack/config. Gas City data then
reflects the desires expressed in VD UI.

Concept:

- VD role templates, prompt assets, skill snippets, executor/model defaults, and
  workflow graph settings compile into a generated Gas City pack.
- A VD workflow may compile to one graph.v2 formula or a composition of formulas.
- Generated files live in runtime/user data paths, not the source-controlled
  `gascity` repo.
- Published VD workflow versions should map to immutable generated pack/formula
  versions or content-addressed artifacts.
- The generated pack should be inspectable and reproducible for audit, but Gas
  City/Beads remain authoritative once a workflow is launched.

Open design points:

- Whether generated formulas are stored as TOML files, passed through a GC HTTP
  API, or both.
- How role-template latest/pinned semantics map to generated pack versions.
- Whether VD-native XML action-result contracts become GC step completion
  schemas, bead metadata, result-note conventions, or prompt-only guidance.
- Whether DRT and requested-changes beads-form contracts become default bundled
  formulas or generated per-workflow formulas.

## UI philosophy

The donor Gas City UI is reference material, not a product UX target.

Preferred direction:

- Keep Workflows as the user's product surface.
- Use simple labels: Start work, Run workflow, Review progress, Needs attention,
  Workflows Library.
- Mention Gas City as the engine/provider in setup/status/admin surfaces.
- Offer a dedicated Gas City technical/admin page or embedded `gc dashboard` only
  as secondary/advanced observability.
- Consider using Gas City's HTTP API for VD-native pages rather than embedding
  the whole dashboard as the primary UX.
- Do not expose formula/sling/convoy/order terminology in first-run user flows
  unless the user is in an advanced configuration panel.

## Ready fanout and isolated worktrees

User wants discussion of parallel work in isolated worktrees inside a VK
workspace. Recommended stance:

- First implementation remains explicit single source-bead launch.
- Ready fanout is a second slice after source launch is stable.
- Fanout should select ready beads, hold a VD workspace-level or provider-level
  launch lock, respect an active-work cap, then invoke one released `gc sling
  ... --on` per selected bead.
- Gas City owns each resulting workflow. VD owns selection, lock, product-safe
  launch summary, and links.
- Parallel write work must use isolated lanes/worktrees with explicit ownership,
  dirty-state checks, and cleanup policies before enabling automated parallel
  writes.
- Released `gc convoy status` may filter candidates by convoy, but convoy
  ready-child expansion should not be implemented privately in VD unless the user
  explicitly approves that temporary bridge.

## Orders and scheduled jobs

Gas City orders may become the right cron/jobs path because Gas City supports
agent calls and mechanical command calls. This should be designed separately from
the first launch/provider slice.

Recommended boundaries:

- First slice: no hidden orders or schedulers.
- Later order design: VD creates/edits high-level schedules; Gas City owns order
  execution and work generation.
- Mechanical commands must remain typed/allowlisted, capped, audited, and never
  become arbitrary shell exposed through normal workflow JSON/UI.
- Notifications/activity should observe order outcomes through the same provider
  read model/callback pipeline, not a separate delivery channel.

## Relationship to completed VD workflow work

### CLI callbacks and activity stream

The existing CLI workflow callback registry and VK activity v1 stack are still
valuable. Gas City-backed launches should publish product-safe callback/activity
summaries into the existing foreground activity surfaces when a VD workflow or
CLI launch requested a callback.

### DRT XML action-results

VD-native DRT XML action-result contracts remain useful for VD-authored prompts,
previews, and possibly generated formula packs. They should not be forced into
Gas City core. If a Gas City-backed workflow returns structured results, VD
should adapt those results through a typed provider read model.

### Parallel review branches

User selected GC fanout first. Therefore:

- Use Gas City formula fanout for production parallel review/work first.
- Keep `vibe-kanban-vscode-web-89ne` VD-native `parallel_review` semantics as a
  later/separate design, useful only if we still need VD workflow-core-native
  fan-out independent of Gas City.

## Validation ladder

### ADR/provider-contract slice

- `git diff --check`
- bead notes updated for CT01 and 1Q0X
- review checks that ADR captures required-GC stance, source-of-truth split,
  provider contract, released command allowlist, pack generation concept,
  ready-fanout discussion, orders discussion, and next questions

### Bridge package slice

- Port `packages/gc-session-vibe/`
- Run `go test ./...` in that package
- Verify adoption behavior against mocked VK endpoints
- Product-safety review for bridge logs/errors

### Provider seam slice

- Fake provider unit tests for health/capabilities/validation/launch/read model
- Gas City provider command-builder tests
- Product-safety scrub/cap tests
- `npm run check-types`
- `git diff --check`

### Explicit launch slice

- Local pinned released `gc` smoke:
  1. initialize or use a test city
  2. create/source a test bead
  3. run `gc formula show --json <formula>` and require `graph.v2`
  4. run `gc sling <target> <source-bead-id> --on <graph.v2 formula>`
  5. assert bead metadata links source/root/workflow ids
  6. assert `gc hook` or work query sees routed work
- VD provider tests for idempotent duplicate launch and product-safe errors

### Realistic local Docker E2E target

User wants a future local Docker E2E using VD/VK QA plus real GC setup. Target
scenario:

1. Start VD/VK QA Docker harness with pinned released `gc` installed.
2. Generate runtime GC config and bridge provider config.
3. Launch a source bead through VD Workflows UI/API.
4. Assert VK sessions receive the expected messages/prompts at the expected time.
5. Simulate agent-like behavior by editing/closing beads through supported typed
   boundaries.
6. Assert Gas City reacts by advancing formula state and routing next work.
7. Assert VD callback/activity/read-model surfaces reflect the authoritative GC
   state product-safely.
8. Capture logs, JSON read models, GC event evidence, VK messages, and browser
   trace/video when browser UI is involved.

## Product-safety requirements

Normal UI/API output must not expose:

- raw shell commands or raw `gc`/`bd`/`git` transcripts
- local paths, env values, secrets, token data, hostnames beyond configured URLs
- raw formula TOML unless in explicit diagnostics/export view
- raw queue/webhook/trigger/delivery/HMAC/internal ids
- provider diagnostics in primary UI
- unbounded stdout/stderr or agent transcripts

Diagnostics may expose more details only in explicitly advanced/admin surfaces
with caps, redaction, and copy explaining that Gas City/Beads are authoritative.

## Implementation milestones

### GCW-1 — ADR/test-plan/provider contract

This document. No implementation.

Acceptance:

- ADR records user decisions and unresolved questions.
- CT01 and 1Q0X beads are updated.
- No code/merge/push.

### GCW-2 — Bridge package port

Port `packages/gc-session-vibe/` from donor branch.

Acceptance:

- Go package builds/tests pass.
- VK-first adoption contract preserved.
- No Workflows UI changes.

### GCW-3 — Gas City provider contract in VD

Add typed server-side provider seam and fake provider tests.

Acceptance:

- Provider health/capability/launch/read-model types exist.
- Product-safe errors and caps are tested.
- Gas City-specific metadata remains opaque outside provider implementation.

### GCW-4 — Released single source-bead launch

Wire pinned released `gc sling ... --on graph.v2` through provider.

Acceptance:

- Formula contract validation rejects non-graph.v2.
- Launch is idempotent by source bead/formula/target/workspace.
- Read model links source/root workflow beads.
- Local released `gc` smoke passes.

### GCW-5 — VD Workflows UI integration

Add product UI for configured Gas City provider status and explicit source-bead
workflow launch.

Acceptance:

- Workflows command center shows engine status.
- User can launch one source bead with a formula/target.
- UI uses product labels, preserves workspace/query context, and avoids raw GC
  jargon in primary flows.

### GCW-6 — Ready-bead fanout with lane/worktree policy

Add explicit ready-bead fanout only after single launch and lane policy are safe.

Acceptance:

- Selection, launch lock, active cap, duplicate/conflict skips, and product-safe
  errors are tested.
- Parallel writes require isolated lanes/worktrees and dirty-state checks.

### GCW-7 — Orders/scheduled jobs design and implementation

Design order-backed cron/jobs separately.

Acceptance:

- Explicit typed order provider contract.
- Mechanical commands are allowlisted and audited.
- No arbitrary shell through workflow JSON/UI.

### GCW-8 — Generated pack from VD workflows

Compile VD workflow definitions/library assets into generated Gas City packs.

Acceptance:

- Generated pack is reproducible and does not mutate source-controlled Gas City.
- Published VD workflow versions map to deterministic generated formula artifacts.
- Runtime uses Gas City as authority after launch.

## Next team discussion/form questions

1. **Required-GC product stance**
   - **Gas City required for production VD Workflows (recommended):** matches the
     latest user direction; unavailable states explain setup/health.
   - Gas City default but VD-native fallback for simple workflows: smoother dev
     fallback, but risks two engines.
   - Keep Gas City separate/admin-only: safest short-term, but misses product
     direction.

2. **Provider seam naming**
   - **WorkflowOrchestratorProvider (recommended):** generic enough for tests but
     clear that it owns orchestration.
   - GasCityProvider only: simpler now, harder to test/replace.
   - ExternalWorkflowProvider: generic, but may imply Gas City is optional.

3. **First code milestone after ADR**
   - **Bridge package port only (recommended):** isolates Go bridge behavior and
     tests before VD UI/runtime coupling.
   - Provider seam first with fake provider: clarifies TypeScript contracts first.
   - Bridge + provider together: faster demo, bigger review surface.

4. **Gas City runtime version policy**
   - **Pinned released `gc` only (recommended):** stable/reviewable; no unreleased
     `convoy expand-ready` dependency.
   - Edge/main behind explicit dev flag: useful for experiments.
   - Commit pin from donor branch: closest to prototype, but not a release
     contract.

5. **Autogenerated pack timing**
   - Design now, implement after single launch: safest.
   - Implement pack generation before launch UI: aligns architecture early but may
     delay visible progress.
   - Defer pack generation until after provider UI: faster launch proof but may
     require rework.

6. **Ready fanout timing**
   - **After single-bead launch and lane policy (recommended):** avoids unsafe
     parallel writes.
   - Immediately after bridge port: faster parallel demo, higher collision risk.
   - Wait for upstream GC convoy expansion: clean authority, slower.

7. **Orders/cron direction**
   - **Design as later scheduled-jobs provider (recommended):** keeps first launch
     manual and reviewable.
   - Expose manual `gc order run` early: useful but introduces order concepts.
   - Implement scheduled orders now: too broad unless urgently needed.

8. **UI surface for vanilla Gas City info**
   - **VD-native Workflows pages plus advanced Gas City status/dashboard link
     (recommended):** keeps UX product-led while preserving GC observability.
   - Embedded `gc dashboard` as primary view: fastest GC-native fidelity, but
     clashes with current Workflows IA.
   - Dedicated Gas City tab only: clear separation, weaker workflow integration.

9. **Realistic Docker E2E scope**
   - **Plan now, implement after single launch works locally (recommended):** keeps
     first validation grounded.
   - Require Docker E2E for bridge package port: may be too early/flaky.
   - Defer Docker until UI: risks late integration surprises.

10. **VD-native workflow-core future**
    - **Use GC for production orchestration; keep VD-native core for preview,
      compatibility, and constrained workflows (recommended).**
    - Migrate all workflow execution to GC immediately.
    - Keep both engines indefinitely with user-selectable mode.
