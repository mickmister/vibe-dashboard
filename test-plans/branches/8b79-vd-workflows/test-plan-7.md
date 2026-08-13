# Test Plan 7: M114 command-step safety design for workflow automation

Branch: `vk/8b79-vd-workflows`

Feature bead: `vibe-kanban-vscode-web-w6qf` — M114 Command-step safety design for workflow automation

Related beads:

- `vibe-kanban-vscode-web-vhx5` — M117 Safe workflow command-step provider.
- `vibe-kanban-vscode-web-cfss` — M115 Sub-workspace lane design for isolated workflow milestones.
- `vibe-kanban-vscode-web-tqhk` — M116 Sub-workspace lane foundation.
- `vibe-kanban-vscode-web-z1on` — M118 Bead-driven meta-workflow sequential pause/resume prototype.
- `vibe-kanban-vscode-web-cahw` — M120 Scheduled workflow and command jobs design.

Earlier plans:

- [`./test-plan-3.md`](./test-plan-3.md) — M90-M100 workflow builder/runtime foundation.
- [`./test-plan-4.md`](./test-plan-4.md) — M101-M111 workflow UX/provenance/CI wait.
- [`./test-plan-5.md`](./test-plan-5.md) — M113 workflow UX completeness audit and M114-M120 roadmap.
- [`./test-plan-6.md`](./test-plan-6.md) — LV2K API-first real-server workflow fixture E2E plan.

## Purpose

M114 is **docs/design only**. It defines the safety contract for future workflow
command steps before any runtime command execution is implemented.

The product goal is eventually to let workflows perform narrowly scoped
command-like automation — for example inspect status, run a known script, create
or update beads, or collect repository facts — without giving arbitrary workflow
JSON the ability to run unrestricted shell commands in a user's workspace.

The design decision for M114 is:

> Workflow command execution must be provider-mediated, policy-checked,
> auditable, bounded, idempotent, and explainable in product read models. Raw
> arbitrary shell execution is not part of the first executable command-step
> implementation.

## M114 recommendations at a glance

1. Add command execution as a typed workflow extension provider, not as generic
   `bash: "..."` embedded in workflow JSON.
2. Prefer `argv` arrays over shell strings. A shell mode can be a separately
   gated future provider, not the default provider contract.
3. Require an execution policy decision before every command step is launched:
   provider id, command id, cwd/lane, args, env, timeout, output caps, and
   permission/approval status.
4. Default cwd to a workflow lane/workspace root chosen by the runtime, not by
   arbitrary config. Relative cwd may be allowed only under that root after
   normalization and symlink checks.
5. Never pass secrets through workflow JSON. Environment variables come from
   named secret/env refs resolved by the runtime/provider policy layer.
6. Store command output as capped/redacted artifacts and parsed result fields,
   not as unbounded terminal logs in workflow history.
7. Treat unsafe/denied commands as product-visible `blocked`/needs-attention
   conditions unless they are system failures.
8. Make command effects idempotent using durable command attempt/effect ids and
   provider-specific idempotency keys.
9. Do not implement runtime execution in M114. M117 should implement the first
   safe provider after M115/M116 lane decisions are clear.

## Vocabulary

| Term               | Meaning                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Command step       | Workflow step that asks a provider to perform a bounded command-like operation.                                                    |
| Command provider   | In-process extension provider that validates, plans, and executes a supported command family.                                      |
| Command definition | Authored workflow JSON for a command step: provider id, command id, args, result contract, and safety policy hints.                |
| Command attempt    | Durable runtime record for one planned command execution attempt.                                                                  |
| Command artifact   | Bounded/redacted stdout/stderr/metadata result stored outside core snapshot when needed.                                           |
| Lane               | Workspace/worktree execution context. M114 assumes a lane/workspace is selected by runtime policy; M115/M116 define it concretely. |
| Approval           | Human or configured permission decision that allows a command step to execute.                                                     |
| Denied command     | Command step rejected before execution by validation or runtime policy.                                                            |

## Command-step schema direction

### Canonical authored JSON shape

M117 should add a supported executable step type similar to this only after M114
is approved:

```json
{
  "id": "collect_status",
  "type": "command",
  "provider": "first_party.command",
  "command": "workspace_status",
  "args": {
    "includeDiffSummary": true,
    "beadId": "{{inputs.beadId}}"
  },
  "policy": {
    "cwd": { "mode": "workspace_root" },
    "timeoutMs": 30000,
    "approval": "not_required",
    "output": {
      "stdoutMaxChars": 20000,
      "stderrMaxChars": 12000,
      "combinedMaxChars": 24000
    }
  },
  "result": {
    "fields": {
      "summary": { "type": "markdown" },
      "exitCode": { "type": "number" },
      "artifactRef": { "type": "string" }
    },
    "required": ["exitCode"],
    "unknownFields": "reject"
  }
}
```

This is intentionally provider-shaped. The workflow config says what supported
command it wants. The provider owns how that maps to a process, API call, or
internal command implementation.

### Provider command spec

Each command provider should register specs like:

```ts
interface WorkflowCommandProviderV1 {
  providerId: string;
  listCommands(): WorkflowCommandSpecV1[];
  validateCommand(input: WorkflowCommandValidateInput): WorkflowCommandIssue[];
  planCommand(input: WorkflowCommandPlanInput): WorkflowCommandPlan;
  executeCommand(
    input: WorkflowCommandExecuteInput,
  ): Promise<WorkflowCommandResult>;
}
```

A command spec should include:

- `providerId` and `command` id.
- Product label/description.
- Args schema.
- Result fields schema.
- Whether it can mutate filesystem, network, beads, git state, or external APIs.
- Default timeout/output caps.
- Required permissions/approvals.
- Allowed cwd modes.
- Retry/idempotency guidance.
- Presentation summary labels.

The provider interface must not allow direct workflow-state mutation. Providers
return typed results/effects; the workflow runtime decides how to advance.

## Argv vs shell policy

### Default: argv command plans

Executable command plans should be `argv`-first:

```ts
type CommandProcessPlan = {
  kind: "process";
  executable: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
};
```

Rules:

- `executable` must be selected by provider policy, not user-authored free text.
- `argv` elements are individual strings. No shell interpolation.
- No `shell: true` default.
- Args are validated before rendering into argv.
- The launched process receives a sanitized environment, not inherited ambient env.

### Deferred: shell provider

A shell-style provider could be considered later only if it has a separate,
high-friction safety model:

- Explicit provider id such as `first_party.approved_shell`.
- Per-workspace/user permission gate.
- Visible approval before first use or per run.
- Strong warning copy and audit trail.
- No secret env by default.
- Strict timeout/output caps.
- Lane isolation required.

Shell strings are a non-goal for M117's first provider unless user explicitly
approves a separate milestone.

## Cwd and filesystem policy

Command steps must not choose arbitrary host paths.

Supported cwd modes for first implementation:

| Mode                    | Meaning                                                 | M117 status                             |
| ----------------------- | ------------------------------------------------------- | --------------------------------------- |
| `workspace_root`        | Runtime-selected workspace/lane checkout root.          | Recommended first.                      |
| `relative_to_workspace` | Provider-approved relative subdir under workspace root. | Optional, with path normalization.      |
| `temp_dir`              | Ephemeral scratch dir created for attempt.              | Optional for read-only/report commands. |

Rules:

- Runtime resolves cwd after lane/workspace selection.
- Reject absolute cwd from workflow JSON.
- Normalize and check relative cwd stays under allowed root.
- Consider symlink traversal unsafe unless explicitly checked/resolved.
- Providers declare filesystem access: `none`, `read`, or `write`.
- Write access should require a workspace/lane write capacity token.
- Future sub-workspace lanes should be the preferred place for write-capable
  command steps.

## Env and secrets policy

Workflow JSON may request named env/secret refs but must not contain raw secret
values.

Recommended schema direction:

```json
"env": {
  "GITHUB_TOKEN": { "secretRef": "github.workflow_ci.token" },
  "CI": { "literal": "1" }
}
```

Rules:

- Raw secret-like values in workflow JSON should be rejected or warned at publish
  time where detectable.
- Providers declare allowed env variable names.
- Runtime resolves secret refs at execution time.
- Secret values are never stored in workflow snapshots, events, artifacts, or
  presentation models.
- Redaction engine receives the resolved secret values and common derived forms
  where possible.
- Child workflow calls should not automatically inherit command env/secrets.
- Prompt/skill refs remain markdown instructions; they do not grant command env
  access.

## Timeout, cancellation, and output caps

Every command attempt needs explicit bounded execution:

- Default timeout: 30 seconds for first provider unless provider overrides lower.
- Maximum timeout: runtime config cap, e.g. 5 minutes for local commands.
- Output caps:
  - stdout default max 20k chars,
  - stderr default max 12k chars,
  - combined event/artifact preview max 24k chars,
  - full raw logs not stored unless a future artifact policy is approved.
- Long output should produce `truncated: true` and stable caps in artifacts.
- Cancellation should be supported at provider/process layer before UI exposes it.
- Timeout result is a normal command failure result unless infrastructure itself
  failed.

## Redaction policy

Command result storage and presentation must run through a redaction pass before
persisting product-visible text.

Redaction inputs:

- Runtime-resolved secrets.
- Provider-declared sensitive args/fields.
- Common token patterns as best-effort defense-in-depth.

Storage split:

| Data                  | Storage                                     | Product display                |
| --------------------- | ------------------------------------------- | ------------------------------ |
| Parsed result fields  | Workflow history/snapshot if small and safe | Yes                            |
| stdout/stderr preview | Artifact/read model after caps/redaction    | Collapsed or summarized        |
| Full raw process logs | Not stored in V1                            | No                             |
| Secret values         | Never                                       | Never                          |
| Executable/argv/cwd   | Audit metadata with safe redaction          | Diagnostics only or summarized |

## Permission, allowlist, and approval model

M114 recommends a layered gate:

1. **Definition validation**: unknown provider/command rejected at publish time.
2. **Provider policy**: command args/cwd/env/result schema validated.
3. **Runtime policy**: workspace/lane capacity, user/workspace permissions,
   timeout/output caps, and approval requirement checked at run time.
4. **Human approval**: if required, workflow creates a normal human attention
   item and pauses before execution.

Suggested approval values:

| Approval value         | Meaning                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `not_required`         | Command is pre-approved by provider/runtime policy.               |
| `per_workflow_version` | User approves this command for a published workflow version.      |
| `per_run`              | User approves before each run.                                    |
| `per_attempt`          | User approves each command attempt; safest for mutating commands. |

Denied/awaiting approval command steps should not be treated as invalid XML
escape hatches. They are normal workflow waits/blocked states owned by command
step semantics.

## Audit and provenance

Every command attempt should create durable audit events:

- Workflow run id and published workflow version.
- State visit id, step id, attempt id, provider id, command id.
- Actor: workflow automation, not human user.
- Approval actor/ref when applicable.
- Workspace/lane id and cwd mode, not raw host path in normal UI.
- Start/end timestamps and duration.
- Exit status, timeout/cancel status, failure category.
- Redaction/truncation flags.
- Artifact refs for capped command output.

Normal UI should say what happened in product terms:

> Workflow ran `Workspace status` in the milestone lane and found 3 changed files.

Diagnostics may expose safe argv/cwd metadata only in a collapsed advanced panel.

## Idempotency and retry model

Command steps are side-effect-prone, so retry semantics must be explicit.

Runtime rules:

- Plan each command with deterministic `attemptId`/`effectId` derived from run,
  state visit, step id, and attempt number.
- Store `pendingEffect` before execution where possible.
- If a duplicate wakeup sees the same pending command, do not launch a second
  process until the prior attempt is terminal or recoverable status is known.
- Provider receives an idempotency key.
- Provider specs declare retry safety:
  - `never_retry_automatically`,
  - `retry_on_infrastructure_failure`,
  - `retry_on_nonzero_exit_if_configured`,
  - `idempotent_safe_retry`.
- V1 should default to no automatic retry for mutating commands.

Failure categories:

| Category                       | Workflow status                     | Meaning                                                             |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------- |
| Validation denied              | `blocked`                           | Config/runtime policy denied command before execution.              |
| Approval required              | waiting/human attention             | User must approve or reject.                                        |
| Non-zero exit                  | action-specific result or `blocked` | Provider decides if workflow can branch on failure.                 |
| Timeout                        | result or `blocked`                 | Product-visible timeout with capped output.                         |
| Runtime infrastructure failure | `failed`                            | Worker/store/process manager failure, not command business failure. |

## Result fields exposed to workflow decisions

A command step should expose a structured result namespace to later prompts and
decision XML validation, similar to human and workflow-call context.

Recommended template context:

```text
{{command.collect_status.exitCode}}
{{command.collect_status.summary}}
{{command.collect_status.artifactRef}}
{{command.collect_status.truncated}}
```

Rules:

- Only declared result fields are exposed to later steps.
- Large stdout/stderr are available by artifact ref or capped summary, not pasted
  wholesale into agent prompts by default.
- Providers can mark fields as markdown-capable, scalar, array, or artifact ref.
- Result fields must be serializable and redacted before becoming prompt context.
- Unknown provider result fields are rejected unless the provider/result contract
  explicitly says preserve.

## Reading bead/status data safely

A key future use case is bead-driven meta-workflows. Command steps should support
this via typed providers, not unrestricted CLI access.

Recommended first providers for bead/status automation:

1. `first_party.beads.read`
   - Read bead title/status/labels/notes/links by bead id.
   - No filesystem access.
   - No network beyond local trusted service/DB boundary.
2. `first_party.beads.update_limited`
   - Append notes or set status only if workflow/user permission allows.
   - Requires explicit approval or workflow-version permission.
3. `first_party.workspace.status`
   - Read git/worktree status summary for the selected lane.
   - Read-only filesystem access.
4. `first_party.command.run_script`
   - Deferred until lane isolation and approval policy are implemented.

This gives workflows useful issue-tracker/status automation while avoiding
`bd`, `git`, or arbitrary shell access as raw command strings.

## UI and read-model display

Normal workflow UI should show command steps as first-class timeline items:

- Title: provider command label, e.g. `Workspace status`.
- Status: queued, waiting for approval, running, complete, blocked, failed.
- Summary: provider result summary and next action.
- Output/artifact links: capped/redacted previews only.
- Provenance: automation/workflow-origin labels, workflow/template/version.
- No raw argv, cwd, host path, env names with secret refs, process pid, or raw
  terminal dump by default.

Design/editor UI should show:

- Supported provider/command picker.
- Args form generated from provider spec.
- Safety summary: reads/writes, cwd mode, env refs, timeout, output caps,
  approval requirement.
- Product validation for missing/unsupported providers and unsafe args.
- JSON diagnostics view-only.

## Lane/workspace isolation assumptions

M114 depends on M115/M116 for durable lane details. Until lanes exist:

- Do not implement write-capable command execution.
- Read-only status providers may run in current workspace only if they cannot
  mutate files and are bounded.
- The first write-capable provider should require a lane/workspace write token.
- Parallel command steps in the same workspace/lane must respect workspace active
  write-turn capacity.
- Future sub-workspace lanes should isolate branch/worktree changes by milestone
  or workflow run.

## Explicit non-goals for M114/M117 first slice

- No runtime command execution in M114.
- No arbitrary shell string provider by default.
- No marketplace plugin packaging.
- No background scheduled command jobs; M120 designs scheduled workflows/jobs.
- No branch push UX; branch push is out of scope for this branch.
- No unrestricted filesystem/network access.
- No storing full raw terminal transcripts.
- No implicit secret inheritance from user shell/session.
- No command step that directly mutates workflow state.
- No UI retry/cancel controls until separately designed and tested.
- No runtime feature flag or hidden command executor in this docs-only milestone.

## Future implementation plan

### M114 — Design only

Deliverables:

- This safety design/test-plan document.
- Reviewer agreement on command provider boundaries.
- No code changes except docs.

Validation:

- Manual docs review.
- `git diff --check`.

### M115/M116 — Lane design/foundation before write commands

Deliverables:

- Workspace/lane ownership, capacity, and cleanup rules.
- Durable lane read model sufficient for command provenance.

### M117 — First safe command provider

Recommended first implementation slice:

1. Extension registry adds `command` step provider interface.
2. Workflow-core accepts `command` step only when provider validation passes.
3. Runtime plans a command attempt as a durable pending effect.
4. Implement one read-only provider, likely `workspace_status` or
   `beads_read_status`.
5. Store capped/redacted command result artifact and typed result fields.
6. Presentation shows command step without raw internals.
7. Unsafe/unknown provider/args tests block publish or runtime execution.

Defer write-capable command providers until lane foundation is ready.

## Acceptance and future test cases

### TEST_CASE_M114_1A — Safety design covers command execution policy

Steps:

1. Reviewer reads this document.
2. Confirm it covers command schema, argv-vs-shell policy, cwd policy,
   env/secrets policy, timeout/caps/redaction, allowlist/approval, audit,
   provenance, idempotency, failure semantics, result fields, UI/read models,
   lane assumptions, and non-goals.
3. Confirm M114 does not implement execution code.

Expected:

- Safety model is explicit enough for M117 TDD.
- Arbitrary shell is deferred/not default.
- Provider-mediated commands are the recommended first executable path.

Validation:

- Docs review.
- `git diff --check`.

### TEST_CASE_M114_1B — Bead/status automation path avoids unrestricted commands

Steps:

1. Reviewer inspects the `Reading bead/status data safely` section.
2. Confirm bead/status use cases are represented as typed providers.
3. Confirm raw `bd`/`git`/shell access is not required for the first meta-workflow
   automation path.

Expected:

- Bead-driven workflow automation can be implemented through safe provider APIs.
- Provider permissions and result contracts are testable without shelling out.

Validation:

- Docs review.

### TEST_CASE_M114_1C — Future tests cover allowed and denied command paths

Steps:

1. Reviewer inspects future test cases below.
2. Confirm unit/provider/runtime/presentation/security/negative/E2E coverage is
   specific enough for M117.
3. Confirm reviewer/tester handoff requires security-negative tests, not just
   happy path execution.

Expected:

- M117 implementation has a TDD-ready checklist.
- Denied/unsafe command behavior is first-class acceptance coverage.

Validation:

- Docs review.

## M117 TDD test matrix

### Workflow-core normalization tests

- Accepts supported `command` step when extension validation returns success.
- Rejects unknown command provider with stable error code/path.
- Rejects unsupported command id with stable error code/path.
- Rejects active state with command step not followed by required final decision
  step if that remains the V1 invariant.
- Rejects command result contracts with unknown field types or invalid required
  refs.
- Rejects unsupported shell-string command config for first provider.

### Provider validation tests

- `argv` command plan contains executable selected by provider and separated args.
- Args schema validates required/optional fields.
- Unsafe args are rejected with product-safe messages.
- Absolute cwd is rejected.
- Relative cwd escaping workspace root is rejected.
- Symlink escape is rejected or explicitly unsupported.
- Env var not in provider allowlist is rejected.
- Raw secret-looking literal is rejected/warned according to policy.
- Timeout and output caps are clamped to runtime maximums.

### Runtime/store tests

- Command attempt is persisted before or atomically with execution handoff.
- Duplicate wakeups do not start duplicate command attempts.
- Retry uses provider idempotency key and respects retry policy.
- Non-zero exit produces typed result or blocked state per provider policy.
- Timeout produces timeout result and capped output.
- Store/recovery catch-up can finish a command attempt after worker restart.
- Unknown/stale command completion observation is ignored/no-op.
- Command does not directly mutate workflow snapshot outside runtime advance path.

### Security and redaction tests

- Secret values do not appear in events, snapshots, artifacts, logs, read models,
  or rendered UI.
- stdout/stderr are capped and mark `truncated: true`.
- Redaction applies before persistence of product-visible output.
- Unsafe cwd/env/provider/command denial does not execute a process.
- Shell metacharacters in args remain literal argv values.
- Product UI does not show raw env or host paths by default.

### Presentation/read-model tests

- Timeline shows command title/status/summary.
- Waiting-for-approval command shows a clear next action.
- Blocked command shows product-level reason and remediation.
- Outputs section shows artifact refs/summaries without raw terminal dump.
- Diagnostics are collapsed and redacted.
- Provenance attributes command to workflow automation, not the human user.

### API/UI tests

- Design editor shows provider/command picker, args form, safety summary, and
  validation errors.
- Unsupported command controls are hidden when no provider is registered.
- Publish rejects unknown/unsafe command config.
- Run launch summary warns when workflow may execute commands and whether
  approval is required.
- Run page shows command progress and result.

### E2E tests

- Allowed read-only command completes and exposes typed result to a later agent
  decision prompt.
- Denied command blocks before execution and explains why.
- Timeout command is capped and product-visible.
- Approval-required command creates attention item; approval resumes; rejection
  blocks/cancels per design.
- Duplicate wakeup does not duplicate execution.
- Secret redaction is verified in presentation JSON and rendered UI.

## M114 deliverable status

This document is the M114 deliverable. It is intentionally a planning artifact: future milestones must add implementation code and tests before any command step can execute.

## Reviewer handoff guidance

Reviewer should verify:

1. The design is strict enough to prevent accidental arbitrary shell execution.
2. The first implementation path is small and TDD-able.
3. Bead/status automation can be useful without raw CLI access.
4. Lane dependency is clearly called out before write-capable commands.
5. Failure/blocked semantics are product-level and recoverable where appropriate.
6. Security-negative tests are included as acceptance, not optional hardening.

Reviewer should block if:

- The plan permits arbitrary shell by default.
- Secrets can be authored directly in workflow JSON or stored in outputs.
- Command output can be persisted unbounded.
- Command execution can bypass workflow runtime state advancement.
- Write-capable commands are proposed before lane/workspace isolation is decided.

## Independent tester handoff guidance

For M114 docs-only testing, tester should:

1. Read this document against bead `vibe-kanban-vscode-web-w6qf`.
2. Confirm all requested safety topics are present.
3. Confirm no runtime command execution was added.
4. Confirm `git diff --check` passed.
5. Mark M114 failed if the document leaves arbitrary shell/cwd/env/secrets/output
   behavior ambiguous.

For future M117 implementation testing, tester should require:

- Focused unit/provider/runtime/security tests.
- Product read-model tests.
- Browser/UI tests if command authoring or run display is visible.
- At least one denied-command test proving no command process was launched.
- At least one redaction test with a sentinel secret string.
