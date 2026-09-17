# ADR 0001: Agent workflow state machine core

## Status

Proposed

## Context

The current workflow runtime can coordinate a narrow two-agent review round, but
future workflows need a self-reliant routing core that does not depend on an
orchestrator agent deciding what happens next.

The next implementation slice should start with TypeScript type shapes and pure
state-machine call stacks before integrating with VK queues, XML parsing, XSD
compilation, or persistence changes.

Relevant process references for the first realistic fixture:

- `test-plans/onboarding/feature-work-process.md` from `origin/vk/3237-vd-mocked-model`
- `test-plans/onboarding/implementer-testing-process.md` from `origin/vk/3237-vd-mocked-model`

Those processes describe a user-story/test-plan phase, implementation with TDD,
implementer self-validation, review, and independent tester verification. The
workflow core should be able to model that kind of role handoff without hardcoding
those exact roles or states.

## Decisions

1. The canonical workflow representation is serializable data, not TypeScript
   classes, Zod schemas, or imperative functions.
2. A workflow state means **who has the ball now**. The state's `ownerRoleId`
   identifies the role expected to perform the next workflow-owned turns.
3. A state may contain multiple sequential turns before a transition decision is
   requested. For example, a developer state may queue an implementation prompt,
   then a self-review prompt, then a final XML decision prompt.
4. Each queued turn declares its expectation. The first slice only needs to model
   `instruction` turns and `decision` turns.
5. The agent may choose only an action available in the current decision turn.
   The workflow engine owns the target state declared by that action.
6. Workflows may contain intentional loops by targeting an earlier or same state.
   Loops are ordinary configured transitions, not implicit retry behavior.
7. The final decision response format is XML. The generated XSD is given to the
   agent verbatim during the final instruction/decision turn so the agent knows
   the valid actions and result shape for that state.
8. XSD/XML generation, XML parsing, and parsed-object validation remain behind
   interfaces until the state-machine core stabilizes.
9. A Zod-like parsed validation layer is likely useful, but the exact shape is a
   deferred decision. See `vibe-kanban-vscode-web-1ws`.
10. Artifact extension points such as beads-form definitions should be designed,
    but not required for the first core slice. See `vibe-kanban-vscode-web-9jh`.

## Proposed TypeScript shape

These types are intentionally plain data. Names are provisional and should be
validated with tests before runtime integration.

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

## Runtime instance shape

The pure core should be independent of DB rows, but it needs a serializable
snapshot that a store can persist later.

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

## Core query API

The first TDD slice should cover these helpers without VK or XML dependencies.

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

## Planned pure call stacks

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
  -> assert terminal states do not declare decision turns with actions
  -> return normalized AgentWorkflowDefinition
```

### Start instance

```text
createInitialSnapshot(definition, input)
  -> normalized = normalizeAgentWorkflowDefinition(definition)
  -> state = normalized.states[normalized.initialStateId]
  -> currentTurnIndex = first turn index for state, usually 0
  -> status = terminal ? completed : running
  -> return AgentWorkflowInstanceSnapshot
```

### Plan current turn

```text
planCurrentTurn(definition, snapshot)
  -> state = getState(snapshot.currentStateId)
  -> owner = getOwner(state.id)
  -> turn = state.turns[snapshot.currentTurnIndex]
  -> render prompt template inputs and prior transition results
  -> if turn.type === 'decision':
       compile current-state XSD through AgentDecisionSchemaCompiler
       append XSD verbatim to final decision instructions
  -> return WorkflowTurnPlan(ownerRoleId, turnId, prompt, expectation)
```

### Advance after a non-decision turn

```text
completeInstructionTurn(definition, snapshot, completedResponseRef)
  -> assert current turn type is instruction
  -> store response ref in runtime state, not as transition history
  -> currentTurnIndex += 1
  -> return updated snapshot and next WorkflowTurnPlan
```

### Apply XML decision

```text
applyDecision(definition, snapshot, parsedDecision)
  -> assert current turn type is decision
  -> state = getState(snapshot.currentStateId)
  -> action = state.on[parsedDecision.actionId]
  -> reject if action does not exist
  -> validate result against action.result contract
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
       resolve to target role/session in later runtime layer
  -> return handoff prompt plans
```

## XML/XSD boundary

The state-machine core should depend on an interface, not an implementation.

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

The XSD is primarily a verbatim agent instruction artifact for the decision
turn. Parsed-response validation details are intentionally deferred.

## First fixture sketch

A first pure fixture can model the later implementation/review/testing loop
without requiring VK:

```text
implementationPlanned [Dev]
  turns:
    - draft implementation plan
    - decision: continuePlanning | submitPlanForReview

planReadyForReview [Review]
  turns:
    - review plan and questions
    - decision: requestPlanChanges | approvePlanForTester

planReadyForTester [Tester]
  turns:
    - review user story, test steps, and review comments
    - decision: requestPlanChanges | approveForImplementation

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

All prompts are data-model fields. Transition handoffs can template prior action
result fields or selected XML fragments into the next role's prompt.

## Consequences

- The first implementation can be TDD-heavy and independent from VK.
- Existing workflow orchestration storage can later persist snapshots and events,
  but the core should not depend on those DB tables initially.
- Follow-up turns become workflow data, not hidden runtime behavior.
- XML/XSD work can proceed behind interfaces after core transition behavior is
  covered by tests.
- Beads-form and other artifacts remain possible through extension points without
  forcing artifact design into the first slice.
