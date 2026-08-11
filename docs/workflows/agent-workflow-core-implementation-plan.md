# Agent Workflow Core Implementation Plan

This document is the reviewer-facing plan for the workflow routing/state-machine
core. It intentionally focuses on the generic workflow logic, not the VK webhook
transport, queue internals, or conversation protocol implementation details.

Milestone: `vibe-kanban-vscode-web-450.1` — M82 update workflow core plan with
final schema decisions.

Roadmap/test plan: [`../../test-plans/branches/8b79-vd-workflows/test-plan-2.md`](../../test-plans/branches/8b79-vd-workflows/test-plan-2.md).

## Purpose

We want a workflow system that can route work between agents, later humans, and
later child workflows without requiring a separate orchestrator agent to decide
what happens next. The workflow config should describe the allowed states,
ordered steps in each state, final decision contracts, and transitions. The pure
core should advance one turn at a time from durable snapshots so that runtime
retries, duplicate wakes, and process restarts do not duplicate work.

M82 is docs-only. It finalizes the executable V1 JSON shape and implementation
plan before the TDD/code milestone begins.

## Background

The branch already has workflow concepts in VD/VK integration work, but much of
that is runtime plumbing: queueing, webhook wakeups, VK session references, and
status/presentation data. This plan separates the pure routing logic from those
transport concerns.

Related decision sources:

- `vibe-kanban-vscode-web-5jq` — final workflow schema details.
- `vibe-kanban-vscode-web-fvm` — workflow core modeling details.
- `vibe-kanban-vscode-web-o4n` — follow-up/turn semantics.
- `vibe-kanban-vscode-web-okj` — plain-English turn progression.
- `vibe-kanban-vscode-web-3vb` — strict V1 workflow core semantics.
- `vibe-kanban-vscode-web-cb7` — contributor-review follow-up decisions.
- `vibe-kanban-vscode-web-b8n` — workflow-to-workflow schema discussion.
- `vibe-kanban-vscode-web-e3p` — workflow-to-workflow and bulk queue design.

## Core mental model

A workflow instance has:

1. a workflow definition,
2. a durable runtime snapshot,
3. the current state,
4. the current step within that state, and
5. zero or one active external turn being waited on.

The core answers one deterministic question:

> Given the workflow definition, the current snapshot, and an optional completed
> turn observation, what is the next snapshot and what external work, if any,
> should the runtime perform?

In V1, the only executable step type is an agent turn. Agent turns are processed
one at a time:

- plan one agent turn,
- let the runtime adapter send the prompt to VK,
- wait for that agent turn to complete,
- observe the completion through an opaque response reference and optional
  result payload,
- advance to the next step or state.

There is no V1 fire-and-forget agent message path. Even a non-decision turn must
complete before the workflow proceeds.

## XState relationship

The schema is XState-inspired, not XState-compatible JSON.

We are borrowing state-machine/statechart ideas: an initial state, named states,
transitions, terminal states, and deterministic transition handling. We are not
adopting XState's authored JSON shape directly. The canonical workflow config
uses product/domain names such as `initialState`, `states`, `owner`, `steps`,
`actions`, and `targetState` instead of XState names such as `initial`, `on`,
and `target`.

Reasons:

- Workflow authors should see terms that match this product's domain.
- Agent-owned states need ordered turns and decision XML contracts, which do not
  map cleanly to raw XState config.
- Runtime capacity, VK queueing, response refs, and future human/workflow steps
  are product concepts, not generic statechart authoring primitives.
- We can still implement the pure core with state-machine discipline and may add
  an exporter/adapter later if that becomes useful.

## V1 executable workflow JSON

### Top-level shape

The executable config does not contain an authored workflow `id`. The workflow
ID comes from the registry key, file key, database key, or other runtime
registration mechanism that loads the config. Runtime snapshots store that
external `workflowId` so instances can be resumed and displayed without
requiring every authored JSON file to duplicate its own ID.

```json
{
  "schemaVersion": 1,
  "name": "dev-review-test-loop",
  "description": "Developer implements, reviews self, reviewer approves, tester validates.",
  "inputs": {
    "featureRequest": { "type": "markdown", "required": true }
  },
  "roles": {
    "dev": {
      "label": "Dev",
      "description": "Implementation agent role"
    },
    "review": {
      "label": "Review",
      "description": "Code review agent role"
    },
    "tester": {
      "label": "Tester",
      "description": "Validation agent role"
    }
  },
  "initialState": "devImplementing",
  "states": {
    "devImplementing": {
      "owner": "dev",
      "steps": [
        {
          "id": "implement",
          "type": "agent_turn",
          "turnType": "non_decision",
          "prompt": {
            "template": "Implement the requested change.\n\nRequest:\n{{inputs.featureRequest}}\n\nPrior handoff, if any:\n{{transition.handoffText}}"
          }
        },
        {
          "id": "selfReviewDecision",
          "type": "agent_turn",
          "turnType": "decision",
          "prompt": {
            "template": "Review your changes. Return only XML matching this state's schema."
          },
          "response": {
            "format": "xml",
            "schema": {
              "format": "xsd",
              "source": "state_actions"
            },
            "invalidXmlRetry": {
              "maxAttempts": 2,
              "prompt": "engine_default_with_validation_errors",
              "onExhausted": "blocked"
            },
            "storeRawXml": true,
            "rawXmlMaxChars": 20000,
            "storeParsedFields": true,
            "unknownFields": "reject_unless_allowed_by_result_contract"
          }
        }
      ],
      "actions": {
        "readyForReview": {
          "label": "Ready for review",
          "targetState": "reviewing",
          "result": {
            "fields": {
              "summary": { "type": "markdown" },
              "concerns": { "type": "markdown", "multiple": true }
            },
            "required": ["summary"],
            "unknownFields": "reject"
          },
          "handoff": {
            "prompt": {
              "template": "Dev completed implementation and self-review.\n\nDecision XML:\n{{transition.rawXml}}"
            }
          }
        },
        "continueEditing": {
          "label": "Continue editing",
          "targetState": "devImplementing",
          "handoff": {
            "prompt": {
              "template": "Continue editing based on your own concerns.\n\nPrevious decision XML:\n{{transition.rawXml}}"
            }
          }
        }
      }
    },
    "reviewing": {
      "owner": "review",
      "steps": [
        {
          "id": "review",
          "type": "agent_turn",
          "turnType": "decision",
          "prompt": {
            "template": "Review the implementation. Return XML choosing an allowed action.\n\nHandoff from prior state:\n{{transition.handoffText}}"
          },
          "response": {
            "format": "xml",
            "schema": { "format": "xsd", "source": "state_actions" },
            "invalidXmlRetry": {
              "maxAttempts": 2,
              "prompt": "engine_default_with_validation_errors",
              "onExhausted": "blocked"
            },
            "storeRawXml": true,
            "rawXmlMaxChars": 20000,
            "storeParsedFields": true,
            "unknownFields": "reject_unless_allowed_by_result_contract"
          }
        }
      ],
      "actions": {
        "approved": {
          "label": "Approved",
          "targetState": "done"
        },
        "changesRequested": {
          "label": "Changes requested",
          "targetState": "devImplementing",
          "result": {
            "fields": {
              "concerns": { "type": "markdown", "multiple": true },
              "requiredChanges": { "type": "markdown" }
            },
            "required": ["requiredChanges"],
            "unknownFields": "reject"
          },
          "handoff": {
            "prompt": {
              "template": "Review requested changes.\n\nReview XML:\n{{transition.rawXml}}"
            }
          }
        }
      }
    },
    "done": { "terminal": true }
  }
}
```

### Authored-ID policy

Map keys are IDs for `roles`, `states`, and `actions`. Authored JSON must not
repeat those IDs inside nested objects. For example, the state key
`"reviewing"` is the state ID and its actions map key `"approved"` is the action
ID.

Ordered `steps` are arrays, so each step keeps an `id` field for stable history,
read-model display, and future targeted retry/debug output.

### Role binding policy

Pure workflow roles are domain roles, not VK transport bindings. V1 executable
workflow JSON should keep role definitions to workflow-owned metadata such as
`label` and `description`. The VD runtime/team/workspace layer resolves a
workflow role like `dev` or `review` to the actual VK session, agent profile, or
queue target. This keeps the pure core independent from VK while still allowing
the runtime adapter to send the planned turn to the correct external agent.

### Active-state invariant

In V1, every non-terminal state is an active state and must satisfy all of these
rules:

- `owner` is required and must reference a configured role.
- `steps` is required and non-empty.
- `actions` is required and non-empty.
- `steps` contains exactly one decision step.
- The decision step is the final step in the state.
- No steps appear after the decision step.
- Every action has a `targetState` that references an existing state.

Actionless active states are deferred. If a future workflow needs a state with
no final decision action, that should be designed intentionally rather than
smuggled into V1.

### Terminal-state invariant

A terminal state is authored exactly as:

```json
{ "terminal": true }
```

No `owner`, `steps`, `actions`, prompts, or additional fields are allowed on an
authored terminal state. The normalized model may represent terminal states as
ownerless states with empty steps/actions, but that is an implementation detail.
Terminal state means normal workflow completion.

## Agent turns and step semantics

### Step type

V1 executable JSON supports only:

```json
{ "type": "agent_turn" }
```

The `steps` array is intentionally generic so future milestones can add step
types such as `human_turn` or `workflow_call` without renaming the core concept.
Those future step types are not executable in V1.

### Turn types

Agent-turn `turnType` values are:

- `"non_decision"` — send the prompt to the state's owner agent, wait for the
  turn to finish, store the opaque response ref, and advance to the next step in
  the same state.
- `"decision"` — send the prompt to the state's owner agent, wait for the turn
  to finish, parse/validate the XML final response, choose one configured action,
  record transition data, and move to the action's `targetState`.

The engine never continues past either turn type until the runtime observes that
the current agent turn completed.

### Follow-up turns

A state may contain multiple sequential agent turns before its final decision
turn. This supports patterns such as:

1. ask Dev to implement,
2. ask Dev to self-review and express concerns,
3. parse the final XML decision,
4. relay that decision context to Review through the transition handoff prompt.

For V1, all these turns are state-local and owned by the state's `owner` role.
Cross-agent communication happens by transitioning to another state whose owner
is a different role.

## Decision XML/XSD contract

Decision turns use XML as the agent's final response format. The XSD for the
current state is supplied to the agent in the final instruction turn so the
agent can see the valid action choices and required result shape.

XML is preferred here because it allows agents to return declarative structured
data with markdown-capable child elements without forcing heavy JSON string
escaping. Markdown text elements should preserve whitespace. CDATA is allowed
where needed for markdown blocks.

V1 parser/validator policy:

- The decision response must select one configured action for the current state.
- The selected action must exist in that state's `actions` map.
- The selected action's optional `result` contract defines which XML child
  elements/fields are valid for that action, which are required, and whether
  unknown fields are rejected or preserved.
- `schema.source: "state_actions"` means the engine derives/supplies an XSD for
  the current state's action set, including each action's `result.fields`,
  `result.required`, and `result.unknownFields` semantics.
- The engine stores parsed fields needed for routing and future prompt
  templates when `storeParsedFields` is true.
- The engine stores bounded raw XML when `storeRawXml` is true.
- Default raw XML cap is `20000` characters per decision response.
- If raw XML exceeds the cap, store the truncated raw XML plus a truncation flag
  and original character count. Do not silently pretend the stored value is
  complete.
- Unknown agent-result fields are rejected by default. They may be preserved only
  when the selected action's `result.unknownFields` explicitly says `"preserve"`.
- Unknown workflow config fields are rejected. The executable workflow JSON is
  strict.

Invalid XML handling:

1. Ask the same agent to retry the same decision turn.
2. Use the engine default retry prompt.
3. Include validation errors in that retry prompt.
4. Stop after the configured `maxAttempts`.
5. On exhaustion, set the runtime snapshot status to `blocked`.

`notify_user` is not an invalid-response escape hatch in V1. User notification is
a normal workflow action/future adapter concern, not part of the XML retry
fallback path.

## Transition context and handoff prompts

When a decision action moves the workflow into a new state, the engine records a
transition entry. In V1, `transition.*` in templates means the latest transition
into the current state.

Example data available to the receiving state's prompt templates:

- `transition.fromState`
- `transition.toState`
- `transition.action`
- `transition.responseRef`
- `transition.rawXml` when stored and not omitted by policy
- `transition.rawXmlTruncated`
- `transition.parsed` when parsed fields are stored
- `transition.handoffText` when the selected action has `handoff.prompt`

Exact V1 handoff behavior:

1. The selected action's `handoff.prompt` is rendered immediately after the
   decision result is accepted.
2. The rendered text is stored on the transition as `transition.handoffText`.
3. No VK message is queued for `handoff.prompt` by itself.
4. The target state's next step prompt remains the actual queued agent message.
5. The target step prompt must explicitly include `{{transition.handoffText}}`,
   `{{transition.rawXml}}`, or parsed transition fields if it wants the receiving
   agent to see that context.

For example, if Review chooses `changesRequested`, the next Dev state's first
step prompt can include the handoff text:

```md
{{transition.handoffText}}

Full review XML, if needed:
{{transition.rawXml}}
```

The receiving Dev agent sees this content only because the target state's step
prompt included it. The workflow engine owns rendering handoff text into
transition context; VK still only sees one normal queued agent message for the
target step.

## Runtime snapshot statuses

Recommended V1 status values:

- `running` — the workflow can plan or is waiting on an active turn.
- `completed` — the workflow reached a terminal state normally.
- `blocked` — recoverable needs-attention condition, such as decision XML retry
  exhaustion. This is a first-class runtime snapshot status, not a configured
  workflow state.
- `failed` — unrecoverable system/config/runtime failure.
- `cancelled` — intentionally stopped by user/system action.

Terminal states and `completed` snapshots represent normal workflow completion.
`blocked` is not a normal configured workflow state and should not be targeted by
workflow `actions`.

Planning behavior:

- `completed`, `failed`, `cancelled`, and `blocked` snapshots produce no-op plan
  results in the happy path.
- No-op terminal/non-running behavior prevents duplicate webhooks or polling
  wakes from becoming error-prone.
- Invalid workflow definitions, invalid normalized models, or impossible active
  running snapshots remain hard errors because they indicate code/config bugs,
  not normal duplicate observations.
- Stale or duplicate observations should be idempotent. V1 should record enough
  active-turn identity/response refs to ignore observations that do not match the
  current wait target.

## Proposed normalized TypeScript shapes

The executable JSON should be parsed into a normalized internal model before the
engine advances snapshots. The exact names can change during TDD, but the shape
should preserve the authored semantics above.

```ts
export type WorkflowId = string;
export type WorkflowStateId = string;
export type WorkflowRoleId = string;
export type WorkflowActionId = string;
export type WorkflowStepId = string;

export type AgentWorkflowDefinitionV1 = {
  schemaVersion: 1;
  name: string;
  description?: string;
  inputs?: Record<string, WorkflowInputSpec>;
  roles: Record<WorkflowRoleId, WorkflowRoleDefinition>;
  initialState: WorkflowStateId;
  states: Record<WorkflowStateId, AuthoredWorkflowStateV1>;
};

export type AuthoredWorkflowStateV1 =
  | { terminal: true }
  | {
      owner: WorkflowRoleId;
      steps: AgentWorkflowStepV1[];
      actions: Record<WorkflowActionId, WorkflowActionV1>;
    };

export type AgentWorkflowStepV1 = {
  id: WorkflowStepId;
  type: 'agent_turn';
  turnType: 'non_decision' | 'decision';
  prompt: PromptTemplateRef;
  response?: DecisionResponsePolicyV1;
};

export type WorkflowActionV1 = {
  label?: string;
  description?: string;
  targetState: WorkflowStateId;
  result?: WorkflowActionResultContractV1;
  handoff?: {
    prompt?: PromptTemplateRef;
  };
};

export type WorkflowActionResultContractV1 = {
  fields: Record<string, ResultFieldSpec>;
  required?: string[];
  unknownFields?: 'reject' | 'preserve';
};

export type ResultFieldSpec = {
  type: 'string' | 'markdown' | 'number' | 'boolean';
  multiple?: boolean;
  description?: string;
};

export type DecisionResponsePolicyV1 = {
  format: 'xml';
  schema: {
    format: 'xsd';
    source: 'state_actions' | { inline: string } | { ref: string };
  };
  invalidXmlRetry: {
    maxAttempts: number;
    prompt: 'engine_default_with_validation_errors';
    onExhausted: 'blocked';
  };
  storeRawXml: boolean;
  rawXmlMaxChars?: number;
  storeParsedFields: boolean;
  unknownFields: 'reject_unless_allowed_by_result_contract';
};
```

Runtime snapshot sketch:

```ts
export type WorkflowSnapshotStatus =
  | 'running'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type WorkflowRuntimeSnapshot = {
  instanceId: string;
  workflowId: WorkflowId;
  status: WorkflowSnapshotStatus;
  currentState: WorkflowStateId;
  currentStepIndex: number;
  visitId: string;
  inputs: Record<string, unknown>;
  waitingFor?: {
    kind: 'agent_turn';
    state: WorkflowStateId;
    stepId: WorkflowStepId;
    turnId: string;
    responseRef?: string;
  };
  latestTransition?: WorkflowTransitionRecord;
  history: WorkflowHistoryEntry[];
};

export type WorkflowTransitionRecord = {
  fromState: WorkflowStateId;
  toState: WorkflowStateId;
  action: WorkflowActionId;
  responseRef?: string;
  rawXml?: string;
  rawXmlTruncated?: boolean;
  rawXmlOriginalChars?: number;
  parsed?: Record<string, unknown>;
  handoffText?: string;
};
```

## Boundary interfaces

The pure core should not import VK, DB, Springboard modules, XML parser
libraries, notification adapters, or scheduler implementations.

Recommended boundaries:

```ts
export interface AgentTurnObservation {
  kind: 'agent_turn_completed';
  turnId: string;
  responseRef: string;
  finalResponseText?: string;
}

export type WorkflowPlanEffect =
  | {
      kind: 'send_agent_turn';
      role: WorkflowRoleId;
      state: WorkflowStateId;
      stepId: WorkflowStepId;
      prompt: string;
    }
  | { kind: 'none' };

export interface DecisionResponseValidator {
  validate(args: {
    state: WorkflowStateId;
    stepId: WorkflowStepId;
    actions: Record<WorkflowActionId, WorkflowActionV1>;
    responseText: string;
    rawXmlMaxChars: number;
  }): DecisionValidationResult;
}
```

The VD runtime adapter is responsible for durable storage, queueing VK agent
messages, polling/webhook wakeups, and calling the validator implementation. The
core is responsible for deterministic state/step routing decisions.

## Planned call stacks

### Start workflow instance

```text
VD action starts workflow
  -> load workflow JSON
  -> normalize/validate definition
  -> create initial runtime snapshot
  -> workflowCore.planNext(snapshot)
  -> runtime persists snapshot with waitingFor turn
  -> runtime adapter sends one VK agent turn
  -> runtime stores opaque turn/session refs
```

### Observe non-decision agent completion

```text
VK webhook or poll notices agent turn completed
  -> VD runtime fetches final response/read-model data by ref when needed
  -> runtime builds AgentTurnObservation
  -> workflowCore.advance(snapshot, observation)
  -> core verifies observation matches waitingFor
  -> core stores responseRef/history
  -> core advances currentStepIndex
  -> core plans the next agent turn in the same state
```

### Observe decision agent completion

```text
VK webhook or poll notices decision turn completed
  -> VD runtime fetches final XML by response/session ref
  -> runtime calls XML/XSD validation boundary
  -> workflowCore.advance(snapshot, observation + validation result)
  -> valid result records raw/parsed transition data according to policy
  -> selected action targetState becomes currentState
  -> same-state target creates a new visit/history entry
  -> terminal target sets status=completed
  -> active target plans exactly one next agent turn
```

### Invalid decision XML

```text
Decision XML validation fails
  -> workflowCore records retry attempt in history
  -> if attempts remain: plan same decision turn again with engine default retry prompt and validation errors
  -> if attempts exhausted: status=blocked with needs-attention reason
```

### Duplicate wake or non-running snapshot

```text
Webhook/poll wakes an already completed, blocked, failed, or cancelled snapshot
  -> workflowCore returns no-op
  -> runtime performs no external side effect
```

## Capacity and workspace access

No capacity, concurrency, or `workspaceAccess` fields belong in executable V1
workflow JSON.

The runtime scheduler owns capacity:

- global active-turn limits,
- per-workspace active-turn limits,
- durable pending runs,
- FIFO/priority behavior,
- retry/backoff scheduling.

The expected initial runtime policy is usually one active turn per workspace so
agents do not edit the same worktree at the same time. Future read-only parallel
turns or parallel write turns should be modeled outside V1 JSON first, likely via
scheduler/runtime config and later optional step-level `workspaceAccess` hints.
If added later, `workspaceAccess` should live on executable step definitions,
not on states or global workflow config, because access needs are tied to the
specific external turn being planned.

A future VK sub-workspace/worktree-lane model can permit parallel write work in
separate lanes without weakening the default one-writer-per-workspace policy.

## Workflow-to-workflow calls

Workflow-to-workflow calls are design/prose only for V1. The executable V1 JSON
must not include a `future` field or executable `workflow_call` step/action
fields.

The reserved future behaviors are documented so V1 does not paint us into a
corner:

- blocking child workflow call,
- fire-and-forget child workflow call,
- terminal/handoff action that starts another workflow,
- mid-workflow child call step,
- bulk/batch enqueue of many child workflow runs.

Future call arguments should be templated from workflow context and validated
against the child workflow input contract. Parent snapshots should record child
instance refs. Blocking calls should also expose child output refs and a child
status summary. Fire-and-forget calls should be ref-only unless a later state
explicitly waits on them.

Bulk calls should become durable pending runs processed by the runtime scheduler
under global and workspace/worktree-lane capacity limits.

## Human steps

Human steps are conceptually part of the same `steps` model, but they are not
V1-executable. A future `human_turn` should create a durable attention item or
form request and resume the workflow when the user responds. Invalid XML retry
exhaustion uses `blocked`; it does not create an implicit human step in V1.

Beads-form artifacts and notification adapters should be integrated through
future explicit step/action semantics, not hidden transport-specific branches in
the pure core.

## Public API to implement in M83+

Suggested TDD target API names:

- `normalizeWorkflowDefinitionV1(definition)`
  - rejects unknown fields,
  - enforces authored-ID policy,
  - enforces active/terminal invariants,
  - emits normalized model with stable IDs from map keys.
- `createInitialWorkflowSnapshot(model, input)`
  - validates input contract enough for V1,
  - initializes first active state or completed terminal state.
- `planNextWorkflowEffect(model, snapshot)`
  - returns exactly one planned agent turn or no-op,
  - no-ops for terminal/non-running snapshots.
- `advanceWorkflow(model, snapshot, observation, validation?)`
  - applies matching turn completions,
  - advances non-decision steps,
  - applies decision transitions,
  - handles invalid XML retry/blocking,
  - ignores stale/duplicate observations idempotently.
- `renderWorkflowPrompt(model, snapshot, step, context)`
  - renders `inputs.*` and latest-transition context for the next agent turn.

## Test setup and TDD plan

M82 itself is docs-only. No implementation tests are added in this milestone.
The following test layers should be used as the later milestones implement the
plan.

### Pure workflow-core unit tests

Target: M83 (`vibe-kanban-vscode-web-450.2`).

Tests should run without VK, VD runtime DB, Springboard, HTTP, or browser
fixtures. They should cover:

- strict config parsing and unknown-field rejection,
- map-key ID normalization,
- active-state invariant failures,
- terminal-state exact authored shape,
- one-agent-turn-at-a-time planning,
- non-decision completion advancing to the next step,
- decision XML valid action transition,
- same-state loop creates a new visit/history entry,
- terminal transition sets `completed`,
- non-running snapshots return no-op,
- invalid XML retry attempts and eventual `blocked` status,
- stale/duplicate observation idempotence.

Preferred location: a new workflow-core test file near the pure package, such as
`packages/workflow-core/test/agent-workflow.test.ts`, or the nearest existing
package test convention discovered during M83.

### VD runtime integration tests

Target: M84 (`vibe-kanban-vscode-web-450.3`).

These tests should prove the durable VD runtime adapter uses the pure core
without breaking restart recovery, polling, webhook wakeups, stored definitions,
or legacy built-in fallback behavior. They should cover idempotent side effects
and duplicate wake behavior.

### VK/VD HTTP read-model tests

Target: M85 (`vibe-kanban-vscode-web-450.4`) and presentation dependencies in
M86/M87.

These tests should prove VD reads workflow-relevant VK data through bounded HTTP
APIs rather than scraping logs/websocket streams. Expected data includes final
response refs/content where permitted, prompt previews if needed for the clean
page, and commit/session refs needed for presentation.

### Docker qa-mode/mock LLM E2E

Target: M89 (`vibe-kanban-vscode-web-450.8`), after the weekly-dev mock branch
merge/harness is available on this branch.

The E2E suite should run through the real VD/VK paths in the containerized
qa-mode sandbox with deterministic mock agent final messages, including malformed
XML for retry/error coverage. This validates the real integration path without
real model tokens.

## Mapping to test-plan-2.md

This plan supports the roadmap user stories in
[`../../test-plans/branches/8b79-vd-workflows/test-plan-2.md`](../../test-plans/branches/8b79-vd-workflows/test-plan-2.md):

- `USER_STORY_1` — directly covered by the final V1 JSON schema decisions in
  this document.
- `USER_STORY_2` — directly covered by the one-turn-at-a-time engine semantics,
  status handling, invalid XML retry/blocking behavior, and pure-core TDD plan.
- `USER_STORY_3` — covered by the runtime boundary and VD runtime integration
  test plan.
- `USER_STORY_4` — covered by the VK/VD HTTP read-model test layer and the rule
  that webhooks are wakeups, not source of truth.
- `USER_STORY_5` — supported by bounded raw XML/parsed-field storage, response
  refs, history, and transition context needed for clean presentation.
- `USER_STORY_6` — reserved through future `human_turn` step semantics and
  `blocked` needs-attention status.
- `USER_STORY_7` — reserved in prose without adding executable V1 fields.
- `USER_STORY_8` — covered by the planned Docker qa-mode/mock LLM E2E layer.

M82 acceptance:

- Update this implementation plan with final schema decisions.
- Keep the milestone docs-only.
- State that the schema is XState-inspired but not XState-compatible JSON.
- Include exact V1 active/terminal invariants.
- Include blocked/runtime status policy.
- Include raw XML storage/truncation policy.
- Include test setup across pure unit, runtime integration, HTTP read-model, and
  Docker qa-mode/mock LLM E2E layers.
- Validate docs locally and commit the plan update for review.

## Validation for M82

Expected validation for this docs-only milestone:

1. Manually review the rendered/linked markdown.
2. Run any lightweight markdown/link/check command if available.
3. Run `git diff --check`.
4. Do not run browser/E2E tests for this docs-only update.

If no markdown checker exists in the repo scripts, record that explicitly in the
handoff.

## Remaining review considerations

No remaining decision blocks M82. The following are intentionally deferred to
future beads/milestones:

- exact XML parser/XSD implementation library and security limits beyond the
  stored raw XML cap,
- exact shape of future `human_turn` and beads-form artifact integration,
- exact shape of future workflow-to-workflow call steps/actions,
- future scheduler capacity configuration and any step-level `workspaceAccess`
  hint,
- clean presentation page read-model details.
