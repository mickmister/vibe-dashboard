# GC Phase 1 Conversation Orchestrator

## Goal

Build a small custom orchestrator on top of Gas City sessions that can coordinate multi-turn work between multiple agent sessions without requiring a full workflow engine.

Phase 1 should prove that we can:

1. start a detached GC session for Agent 1
2. let Agent 1 do an initial task
3. ask Agent 1 whether it has questions
4. collect Agent 1 output
5. start or reuse Agent 2
6. send Agent 2 the relevant conversation context plus an instruction to respond to Agent 1
7. pipe Agent 2's response back into Agent 1 as a follow-up
8. repeat or stop based on simple rules

---

## Non-goals

Phase 1 should **not** try to solve all of the following:

- durable workflow execution across crashes
- arbitrary graph-based agent routing
- generalized no-code workflow composition
- transcript-perfect replay across all providers
- human approval UX beyond basic operator controls
- provider-specific structured pending/respond support

If we later need those, we can evaluate Temporal, Inngest, LangGraph, or similar systems.

---

## Why custom code first

Gas City already provides the hard runtime substrate:

- session creation
- detached/background sessions
- semantic message submit behavior
- queued follow-ups
- session peek/log access
- interrupt/kill/suspend/wake primitives

What we still need is mostly application-specific orchestration:

- deciding what to send next
- deciding when a turn is complete
- selecting what context to forward
- deciding when to stop or escalate
- tracking orchestration state

That is small enough for custom code in Phase 1.

---

## Proposed shape

### Location

A good first location would be a new package in the VD repo, outside the UI plugin tree:

- `packages/gc-orchestrator/`

Possible substructure:

- `packages/gc-orchestrator/src/types.ts`
- `packages/gc-orchestrator/src/state.ts`
- `packages/gc-orchestrator/src/gc-client.ts`
- `packages/gc-orchestrator/src/transcript.ts`
- `packages/gc-orchestrator/src/orchestrators/research-refine.ts`
- `packages/gc-orchestrator/src/index.ts`

The GC dashboard plugin can later consume this package.

---

## Core Phase 1 use case

### Workflow name

`research-refine`

### Participants

- **Agent 1**: researcher / planner
- **Agent 2**: reviewer / responder

### Basic flow

1. Create or reuse Agent 1 session.
2. Submit initial prompt:
   - research topic
   - make a plan for discussion
3. Queue or submit follow-up:
   - ask whether Agent 1 has any questions
4. Observe Agent 1 output until:
   - a question is detected, or
   - turn timeout is reached
5. Create or reuse Agent 2 session.
6. Send Agent 2:
   - selected context from Agent 1
   - explicit instruction to answer Agent 1
7. Observe Agent 2 output until a response is ready.
8. Submit Agent 2's response back into Agent 1 as a follow-up.
9. Either:
   - stop after one loop, or
   - repeat with a loop limit.

---

## Control model

Phase 1 should use a simple explicit state machine.

Suggested states:

- `idle`
- `starting_agent1`
- `waiting_agent1_initial`
- `waiting_agent1_questions`
- `starting_agent2`
- `waiting_agent2_response`
- `sending_back_to_agent1`
- `completed`
- `failed`
- `canceled`

Suggested events:

- `run_created`
- `session_created`
- `message_submitted`
- `output_observed`
- `question_detected`
- `response_detected`
- `timeout`
- `error`
- `operator_cancel`

This should be implemented in plain code first, not a separate workflow DSL.

---

## GC integration boundary

Phase 1 should talk to Gas City through stable interfaces only.

### Minimum commands/API surface

- `gc session new <template> --alias <alias> --no-attach`
- `gc session submit <alias> <message> --intent <intent>`
- `gc session peek <alias> --lines <n>`
- `gc session list --json`
- `gc session interrupt <alias>` or `kill`/`close` equivalents as needed

If the GC API is already available in the running environment, Phase 1 may wrap HTTP instead of CLI, but the interface should stay narrow.

### Important note

Do **not** couple Phase 1 directly to the internal details of the `gc-session-vibe` bridge.

The orchestrator should think in terms of:

- session alias
- message submit
- output snapshot
- session status

not provider internals.

---

## Transcript strategy

Phase 1 should keep transcript handling intentionally simple.

### Source of truth

Use GC session output snapshots plus orchestrator-side stored messages.

### Stored records

For each orchestrated run, store:

- initial prompt to Agent 1
- follow-up prompt asking for questions
- extracted Agent 1 question block
- prompt sent to Agent 2
- extracted Agent 2 response block
- follow-up sent back to Agent 1

### Avoid in Phase 1

- trying to reconstruct perfect provider-native transcript history
- relying on provider-specific pending/respond semantics

---

## Output extraction rules

Phase 1 needs lightweight extraction heuristics.

### First pass heuristic approach

Implement small pluggable functions such as:

- `extractQuestionBlock(output: string): string | null`
- `extractResponseBlock(output: string): string | null`
- `isTurnComplete(output: string): boolean`

For Phase 1, these can be simple and prompt-shaped.

Example prompt conventions:

- tell Agent 1 to end its question block with `END_QUESTIONS`
- tell Agent 2 to end its reply with `END_RESPONSE`

This is much more reliable than trying to infer completion from arbitrary prose.

---

## State persistence

Phase 1 should persist enough state to resume inspection, even if we do not fully support crash recovery yet.

Suggested run record:

```ts
interface OrchestratorRun {
  id: string
  workflow: 'research-refine'
  status:
    | 'idle'
    | 'starting_agent1'
    | 'waiting_agent1_initial'
    | 'waiting_agent1_questions'
    | 'starting_agent2'
    | 'waiting_agent2_response'
    | 'sending_back_to_agent1'
    | 'completed'
    | 'failed'
    | 'canceled'
  agent1SessionAlias: string
  agent2SessionAlias: string
  topic: string
  iteration: number
  maxIterations: number
  lastObservedAgent1Output?: string
  lastObservedAgent2Output?: string
  extractedQuestion?: string
  extractedResponse?: string
  error?: string
  createdAt: string
  updatedAt: string
}
```

### Storage options

Phase 1 can use one of:

- JSON files in a local state directory
- SQLite if we already want queryability

Recommendation for Phase 1:

- start with **JSON file state**
- upgrade later if the UI needs richer querying

---

## Operator controls

Phase 1 should expose a small set of controls:

- start run
- inspect run state
- cancel run
- retry failed step
- open Agent 1 session
- open Agent 2 session

The first implementation can be CLI or library-only.

A later VD plugin UI can show:

- current orchestrator state
- linked GC sessions
- extracted question/response
- last error
- operator actions

---

## Error handling

Phase 1 should explicitly handle:

- session creation failure
- no output detected within timeout
- no question block found
- no response block found
- GC command failure
- provider session terminated unexpectedly

Recommended behavior:

- mark run `failed`
- preserve captured output and step name
- allow operator retry from last stable state

---

## Suggested first API

```ts
interface StartResearchRefineRunInput {
  topic: string
  agent1Template: string
  agent2Template: string
  agent1Alias?: string
  agent2Alias?: string
  maxIterations?: number
}

interface OrchestratorService {
  startResearchRefineRun(input: StartResearchRefineRunInput): Promise<OrchestratorRun>
  tickRun(runId: string): Promise<OrchestratorRun>
  getRun(runId: string): Promise<OrchestratorRun | null>
  listRuns(): Promise<OrchestratorRun[]>
  cancelRun(runId: string): Promise<void>
}
```

### Why `tickRun`

A simple polling/tick model is a good Phase 1 fit because it avoids introducing:

- a durable job runner
- a separate queue system
- a background daemon requirement

We can run ticks:

- from a small loop
- from a dev CLI
- from a VD backend process

---

## Suggested prompting contract

### Agent 1 initial prompt

Tell Agent 1 to:

- research the topic
- produce a draft plan for discussion
- then list open questions, if any
- end the questions section with a sentinel token

### Agent 2 prompt

Tell Agent 2 to:

- read the provided Agent 1 context
- answer Agent 1's open questions directly
- keep the response concise and actionable
- end with a sentinel token

### Benefit

This turns orchestration into a controlled protocol rather than fuzzy free-form inference.

---

## Phase 1 acceptance criteria

Phase 1 is successful if we can reliably demonstrate:

1. Agent 1 session is created in GC.
2. Agent 1 produces a plan and questions.
3. Agent 2 receives the selected context.
4. Agent 2 produces a response.
5. Agent 2's response is submitted back into Agent 1.
6. The orchestrator records each step and final status.
7. The operator can inspect and cancel runs.

---

## Nice follow-ups after Phase 1

### Phase 1.5

- VD plugin UI for run inspection
- richer transcript views
- configurable timeouts and retry policies
- better extraction/parsing rules

### Phase 2

Consider a workflow engine only if we need:

- durable recovery after crashes
- timers spanning long durations
- many concurrent orchestrated runs
- cross-process scheduling
- audit-quality workflow history

At that point, evaluate:

- **Temporal**
- **Inngest**
- **LangGraph**

LangFlow is better treated as a prototyping or demo surface, not the default core orchestration layer here.
