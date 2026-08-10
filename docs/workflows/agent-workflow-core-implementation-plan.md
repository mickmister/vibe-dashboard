# Agent Workflow Core Implementation Plan

## Purpose

This document is a reviewer-facing implementation plan for the next workflow
foundation slice. It assumes the reviewer has not followed the recent workflow
architecture discussion.

The goal is to implement a pure TypeScript state-machine core for agent
workflows before integrating with VK queueing, XML parsing, XSD generation,
persistence, or UI editing.

## Background

The branch currently contains workflow infrastructure in two areas:

1. `vibe-kanban` provides execution substrate pieces such as queued follow-up
   messages, queue statuses, activity snapshots, and terminal execution webhooks.
2. `vibe-kanban-vscode-web` contains workflow/runtime code, including the current
   durable declarative runtime in `src/workflows/declarative/`.

The existing VD declarative runtime is useful but narrow: it models a specific
source-agent → reviewer-agent → optional overseer pattern. The next system needs
a more general routing core where workflows are represented as serializable data
and the workflow engine, not an orchestrator agent, determines allowed state
transitions.

The architecture direction is captured in:

- `docs/adr/0001-agent-workflow-state-machine-core.md`

Deferred decisions are tracked separately:

- `vibe-kanban-vscode-web-1ws`: parsed XML / Zod-like validation layer
- `vibe-kanban-vscode-web-9jh`: artifact extension points such as beads-form in
  workflow XML responses

## Core mental model

The central workflow model is:

```text
current state + current turn + agent result/action => next state + next turn plan
```

A state means **who has the ball now**. The role that owns a state is the role
expected to perform the next workflow-owned turn(s). A state may contain multiple
sequential turns before a transition decision is requested.

Example:

```text
implementationInProgress [Dev]
  1. instruction: implement the requested change
  2. instruction: review your own diff and identify concerns
  3. decision: choose continueEditing or submitCodeForReview using XML
```

Instruction turns queue normal agent messages and do not transition state.
Decision turns ask the agent to choose one available action and provide a
structured result. The agent may choose an action, but the workflow engine owns
the target state declared by that action.

Configured loops are allowed. For example, `continueEditing` may target
`implementationInProgress`; this is an intentional workflow transition, not an
implicit retry.

## Important XML/XSD context

The final decision response format is expected to be XML. The XSD is mainly for
agent guidance and validation: the generated XSD for the current state will be
given to the agent verbatim during the final decision instruction turn so the
agent knows exactly which actions and result fields are valid.

However, this implementation slice should **not** implement XML parsing, XSD
generation, or parsed XML validation. Those should remain behind interfaces so
we can first prove the state-machine model with pure tests.

The parsed XML validation strategy, including whether/how to use Zod, is a
follow-up decision.

## Non-goals for this slice

Do not implement these yet:

- real XML parsing
- real XSD generation
- Zod or parsed-object validation details
- beads-form artifact embedding
- VK queue adapter integration
- DB persistence or migration changes
- integration into `src/workflows/declarative/runtime.ts`
- workflow editor UI
- browser-visible changes or E2E tests

## Proposed location

Add the new pure workflow core under the reusable package:

```text
packages/workflow-core/src/agent-workflow/
```

Proposed files:

```text
packages/workflow-core/src/agent-workflow/types.ts
packages/workflow-core/src/agent-workflow/errors.ts
packages/workflow-core/src/agent-workflow/normalize.ts
packages/workflow-core/src/agent-workflow/model.ts
packages/workflow-core/src/agent-workflow/instance.ts
packages/workflow-core/src/agent-workflow/planning.ts
packages/workflow-core/src/agent-workflow/index.ts
packages/workflow-core/test/agent-workflow.test.ts
```

Export the public API from:

```text
packages/workflow-core/src/index.ts
```

Rationale: this logic should be independent from VD server runtime and reusable
by tests, future persistence adapters, XML/XSD adapters, and UI/editor code.

## Proposed TypeScript shapes

The canonical representation should be plain serializable data.

```ts
export type WorkflowDefinitionVersion = 1;
export type WorkflowId = string;
export type WorkflowStateId = string;
export type WorkflowRoleId = string;
export type WorkflowTurnId = string;
export type WorkflowActionId = string;
export type WorkflowTemplate = string;

export interface AgentWorkflowDefinition {
  id: WorkflowId;
  version: WorkflowDefinitionVersion;
  name: string;
  description?: string | null;
  initialStateId: WorkflowStateId;
  roles: Record<WorkflowRoleId, AgentWorkflowRole>;
  states: Record<WorkflowStateId, AgentWorkflowState>;
}

export interface AgentWorkflowRole {
  id: WorkflowRoleId;
  displayName: string;
  description?: string | null;
}

export interface AgentWorkflowState {
  id: WorkflowStateId;
  ownerRoleId: WorkflowRoleId;
  description?: string | null;
  terminal?: boolean;
  turns: AgentWorkflowTurn[];
  on: Record<WorkflowActionId, AgentWorkflowAction>;
}

export type AgentWorkflowTurn =
  | AgentWorkflowInstructionTurn
  | AgentWorkflowDecisionTurn;

export interface AgentWorkflowInstructionTurn {
  id: WorkflowTurnId;
  type: 'instruction';
  prompt: WorkflowPromptSpec;
  expectation: {
    type: 'none' | 'completed_response';
  };
}

export interface AgentWorkflowDecisionTurn {
  id: WorkflowTurnId;
  type: 'decision';
  prompt: WorkflowPromptSpec;
  responseContract: WorkflowDecisionResponseContractRef;
}

export interface WorkflowPromptSpec {
  template: WorkflowTemplate;
  include?: WorkflowPromptInclude[];
}

export type WorkflowPromptInclude =
  | { type: 'input'; key: string }
  | { type: 'state'; path: string }
  | { type: 'transitionResult'; transitionId: string; path?: string }
  | { type: 'xmlFragment'; transitionId: string; actionId?: WorkflowActionId };

export interface AgentWorkflowAction {
  id: WorkflowActionId;
  label: string;
  description?: string | null;
  targetStateId: WorkflowStateId;
  result: WorkflowResultContract;
  handoff?: WorkflowHandoffSpec[];
}

export interface WorkflowHandoffSpec {
  toRoleId: WorkflowRoleId;
  prompt: WorkflowPromptSpec;
}

export interface WorkflowResultContract {
  fields: Record<string, WorkflowResultField>;
  required?: string[];
  extensions?: WorkflowResultExtensionPoint[];
}

export type WorkflowResultField =
  | { type: 'string'; description?: string | null }
  | { type: 'markdown'; description?: string | null; cdata?: boolean }
  | { type: 'stringList'; description?: string | null; itemName?: string }
  | { type: 'enum'; values: string[]; description?: string | null };

export interface WorkflowResultExtensionPoint {
  id: string;
  description?: string | null;
  minItems?: number;
  maxItems?: number;
}

export interface WorkflowDecisionResponseContractRef {
  compiler: 'xsd';
  includeActions: 'currentState';
}
```

## Runtime snapshot shapes

The first slice should use serializable snapshots rather than a DB-backed model.
A later adapter can persist this shape or map it into existing orchestration
storage.

```ts
export interface AgentWorkflowInstanceSnapshot {
  instanceId: string;
  workflowId: WorkflowId;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  currentStateId: WorkflowStateId;
  currentTurnIndex: number;
  input: Record<string, unknown>;
  transitionHistory: AgentWorkflowTransitionEvent[];
}

export interface AgentWorkflowTransitionEvent {
  id: string;
  fromStateId: WorkflowStateId;
  actionId: WorkflowActionId;
  targetStateId: WorkflowStateId;
  actorRoleId: WorkflowRoleId;
  result: Record<string, unknown>;
  rawXml?: string;
  occurredAt: string;
}
```

## Boundary interfaces

These interfaces let the planner include XML/XSD concepts without implementing
them in this slice.

```ts
export interface AgentDecisionSchemaCompiler {
  compileCurrentStateDecisionSchema(args: {
    workflow: AgentWorkflowDefinition;
    stateId: WorkflowStateId;
  }): Promise<AgentDecisionSchema> | AgentDecisionSchema;
}

export interface AgentDecisionSchema {
  format: 'xsd';
  schemaText: string;
  instructions: string;
}

export interface AgentDecisionResponseParser {
  parse(args: {
    workflow: AgentWorkflowDefinition;
    stateId: WorkflowStateId;
    xml: string;
  }): Promise<ParsedAgentDecision> | ParsedAgentDecision;
}

export interface ParsedAgentDecision {
  actionId: WorkflowActionId;
  result: Record<string, unknown>;
  rawXml: string;
}
```

## Public API to implement

### Definition normalization

```ts
normalizeAgentWorkflowDefinition(raw: unknown): AgentWorkflowDefinition
```

Validation requirements:

- input is an object
- `version` is supported
- required strings are present and non-empty
- `initialStateId` references an existing state
- role map keys match role IDs
- state map keys match state IDs
- every `ownerRoleId` references an existing role
- every action target references an existing state
- action map keys match action IDs
- turn IDs are unique per state
- terminal states cannot expose actions
- non-terminal states have at least one turn
- result contract required fields reference declared fields
- enum fields have at least one value

### Query model

```ts
createAgentWorkflowModel(definition: AgentWorkflowDefinition): AgentWorkflowDefinitionModel
```

```ts
export interface AgentWorkflowDefinitionModel {
  getInitialState(): AgentWorkflowState;
  getState(stateId: WorkflowStateId): AgentWorkflowState;
  getOwner(stateId: WorkflowStateId): AgentWorkflowRole;
  getCurrentTurn(snapshot: AgentWorkflowInstanceSnapshot): AgentWorkflowTurn;
  getAvailableActions(stateId: WorkflowStateId): AgentWorkflowAction[];
  getAction(stateId: WorkflowStateId, actionId: WorkflowActionId): AgentWorkflowAction;
  getTargetState(stateId: WorkflowStateId, actionId: WorkflowActionId): AgentWorkflowState;
  getResultContract(stateId: WorkflowStateId, actionId: WorkflowActionId): WorkflowResultContract;
}
```

### Instance helpers

```ts
createInitialSnapshot(definition, input, options): AgentWorkflowInstanceSnapshot
completeInstructionTurn(definition, snapshot, completedResponseRef): AgentWorkflowInstanceSnapshot
applyDecision(definition, snapshot, parsedDecision, options): AgentWorkflowDecisionApplyResult
```

Important behavior:

- instruction turns advance `currentTurnIndex`
- instruction turns do not create transition events
- decisions are accepted only during decision turns
- invalid or unavailable action IDs are rejected
- the action target state comes from the definition, not from agent output
- configured loops are allowed
- terminal target states set snapshot status to `completed`
- raw XML, when supplied, is preserved on the transition event

### Planning helpers

```ts
planCurrentTurn(definition, snapshot, options): Promise<AgentWorkflowTurnPlan>
planTransitionHandoffs(definition, transitionEvent): AgentWorkflowHandoffPlan[]
```

`planCurrentTurn` should return enough information for a later runtime adapter to
queue the next message to the current owner role.

For decision turns, it should call the injected `AgentDecisionSchemaCompiler` and
include the returned XSD/instructions in the plan.

## Planned call stacks

### Normalize definition

```text
normalizeAgentWorkflowDefinition(raw)
  -> assert serializable object
  -> normalize roles
  -> normalize states
  -> assert initialStateId exists
  -> assert every state ownerRoleId exists
  -> assert every transition targetStateId exists
  -> assert every state has unique turn ids
  -> assert every state action id matches its map key
  -> assert terminal states do not declare actions
  -> return normalized AgentWorkflowDefinition
```

### Start instance

```text
createInitialSnapshot(definition, input)
  -> normalized = normalizeAgentWorkflowDefinition(definition)
  -> state = normalized.states[normalized.initialStateId]
  -> currentTurnIndex = 0
  -> status = terminal ? completed : running
  -> return AgentWorkflowInstanceSnapshot
```

### Plan current turn

```text
planCurrentTurn(definition, snapshot)
  -> state = getState(snapshot.currentStateId)
  -> owner = getOwner(state.id)
  -> turn = state.turns[snapshot.currentTurnIndex]
  -> render or expose prompt template data
  -> if turn.type === 'decision':
       compile current-state XSD through AgentDecisionSchemaCompiler
       attach XSD text to final decision instructions
  -> return WorkflowTurnPlan(ownerRoleId, turnId, prompt, expectation)
```

### Complete non-decision turn

```text
completeInstructionTurn(definition, snapshot, completedResponseRef)
  -> assert current turn type is instruction
  -> store or expose response ref in runtime turn state, if modeled now
  -> currentTurnIndex += 1
  -> return updated snapshot
```

### Apply decision

```text
applyDecision(definition, snapshot, parsedDecision)
  -> assert current turn type is decision
  -> state = getState(snapshot.currentStateId)
  -> action = state.on[parsedDecision.actionId]
  -> reject if action does not exist
  -> validate basic result required fields
  -> target = getState(action.targetStateId)
  -> append transition event with raw XML and parsed result
  -> set currentStateId = target.id
  -> set currentTurnIndex = 0
  -> status = target.terminal ? completed : running
  -> return updated snapshot and planned handoff prompts
```

### Render handoff prompts

```text
planTransitionHandoffs(definition, transitionEvent)
  -> action = getAction(transitionEvent.fromStateId, transitionEvent.actionId)
  -> for each handoff spec:
       render prompt with transition result and optionally selected XML fragments
       resolve to target role/session in a later runtime layer
  -> return handoff prompt plans
```

## First test fixture

Use a compact Dev / Review / Tester workflow that reflects the intended real
process while staying pure and deterministic.

```text
implementationInProgress [Dev]
  turns:
    - implement
    - self-review code and list concerns
    - decision: continueEditing | submitCodeForReview

codeReadyForReview [Review]
  turns:
    - review code and developer concerns
    - decision: requestCodeChanges | approveForTesting

codeReadyForTesting [Tester]
  turns:
    - test code
    - decision: approve | denyNotTestable | denyBugOrIncorrect
```

Expected configured transitions:

```text
Dev.submitCodeForReview -> codeReadyForReview
Dev.continueEditing -> implementationInProgress
Review.requestCodeChanges -> implementationInProgress
Review.approveForTesting -> codeReadyForTesting
Tester.denyNotTestable -> implementationInProgress
Tester.denyBugOrIncorrect -> implementationInProgress
Tester.approve -> completed
```

The `completed` state can be a terminal state owned by Dev or a special terminal
role, depending on what makes the implementation simplest. The test should make
that decision explicit.

## Test plan

Add tests in:

```text
packages/workflow-core/test/agent-workflow.test.ts
```

Recommended tests:

1. normalizes a valid Dev/Review/Tester workflow
2. rejects missing initial state
3. rejects unknown owner role
4. rejects unknown transition target
5. rejects invalid terminal state with actions
6. rejects required result fields that are not declared
7. returns owner as “who has the ball now”
8. plans sequential instruction turns before decision
9. does not transition after instruction turn completion
10. decision turn exposes only current-state actions
11. rejects unavailable action
12. applies engine-owned target state
13. allows configured loop transition
14. renders handoff plan using transition result
15. marks terminal target completed
16. preserves raw XML on transition event when supplied

## Suggested implementation order

1. Add `types.ts` and `errors.ts`.
2. Add failing tests for definition normalization.
3. Implement `normalizeAgentWorkflowDefinition`.
4. Add failing tests for query model helpers.
5. Implement `createAgentWorkflowModel`.
6. Add failing tests for initial snapshot and instruction-turn advancement.
7. Implement `createInitialSnapshot` and `completeInstructionTurn`.
8. Add failing tests for decision application and configured loops.
9. Implement `applyDecision`.
10. Add failing tests for turn planning with a fake XSD compiler and handoff
    prompt planning.
11. Implement `planCurrentTurn` and `planTransitionHandoffs`.
12. Export the public API from package index.
13. Run focused package tests and type checks.

## Validation commands

Preferred focused validation:

```bash
pnpm --filter @vibe-dashboard/workflow-core test
```

If that is not wired in this workspace, use:

```bash
pnpm exec vitest run --config packages/workflow-core/vitest.config.ts
```

Then run repo type checks:

```bash
npm run check-types
```

This slice is pure logic and docs; no browser-visible behavior is expected, so
Playwright/E2E validation is not required unless implementation unexpectedly
changes UI behavior.

## Reviewer questions

Please review these decisions before implementation:

1. Is `packages/workflow-core/src/agent-workflow/` the right home for this pure
   core?
2. Is it acceptable to keep XML/XSD as interfaces only in this first slice?
3. Does the Dev / Review / Tester fixture capture enough of the intended
   workflow behavior for initial TDD?
4. Should terminal states have an owner role, or should the model support an
   ownerless terminal state?
5. Should instruction-turn completion store response refs in the snapshot now,
   or should that wait until persistence/runtime integration?
