# Agent Workflow System — Developer Handoff

## Goal

Build a configurable finite-state workflow system in TypeScript for coordinating role-based agents.

The core model is:

**State → available actions → next state**

Each state is owned by a role. When an agent operates in that state, it may choose only from the actions defined for that state.

## Example

```ts
{
  initial: "codeDeveloped",

  states: {
    codeDeveloped: {
      owner: "developer",

      on: {
        submitForReview: {
          target: "readyForReview",

          result: {
            type: "object",
            properties: {
              summary: { type: "string" }
            },
            required: ["summary"]
          }
        }
      }
    },

    readyForReview: {
      owner: "reviewer",

      on: {
        approve: {
          target: "approvedByReviewer",
          result: {
            type: "object",
            properties: {
              summary: { type: "string" }
            },
            required: ["summary"]
          }
        },

        requestChanges: {
          target: "changesRequestedByReviewer",
          result: {
            type: "object",
            properties: {
              reason: { type: "string" },
              requestedChanges: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["reason", "requestedChanges"]
          }
        }
      }
    }
  }
}
```

`result` is JSON Schema describing the structured information an agent must return when choosing that action.

## Important Semantics

A state represents **who has the ball now**, not necessarily who produced the state.

For example:

```text
ReadyForTesting [Tester]
       |
     approve
       ↓
ApprovedByTester [Developer]
```

The Tester caused `ApprovedByTester`, but the Developer owns that state because the Developer acts next.

Roles will initially include:

```text
Developer
Reviewer
Tester
```

Example workflow:

```text
CodeDeveloped [Developer]
       |
       | submitForReview
       ↓
ReadyForReview [Reviewer]
       |
       ├── requestChanges → ChangesRequestedByReviewer [Developer]
       |
       └── approve → ApprovedByReviewer [Tester]
                          |
                          ↓
                   ReadyForTesting [Tester]
                          |
              ┌───────────┼───────────┐
              ↓           ↓           ↓
       requestChanges  disapprove   approve
              ↓                       ↓
 ChangesRequestedByTester      ApprovedByTester
      [Developer]                 [Developer]
```

## Design Requirements

The workflow must eventually be editable through a UI, so **do not make TypeScript types or Zod schemas the canonical workflow representation**.

Use a serializable JSON/data model with IDs/references for relationships.

We should strongly consider adopting XState/statechart semantics rather than inventing transition behavior ourselves.

The system should be able to answer, given an arbitrary current state:

```ts
getState(...)
getOwner(...)
getAvailableActions(...)
getTargetState(...)
getResultSchema(...)
```

## Agent Output / Schema Direction

Agents will return structured results.

For a particular state, we should be able to dynamically derive a schema containing **only the actions currently available**.

For example, a Tester might be constrained to:

```text
approve(result)
requestChanges(result)
disapprove(result)
```

We currently expect to:

1. Store action result contracts as JSON Schema.
2. Determine applicable actions from the current workflow state.
3. Generate a state-specific agent response schema.
4. Compile that response contract to **XSD (XML Schema)**.
5. Have the agent return XML conforming to that XSD.
6. Validate the XML and use the selected action to perform the state transition.

The workflow engine determines the target state. The agent chooses an action and supplies its result; it should **not** be allowed to arbitrarily choose its next state.

## Initial Implementation

Start with the workflow data model and transition/query layer.

Keep XSD/XML generation behind an interface for now:

```ts
interface AgentResponseSchemaCompiler {
  compile(
    workflow: Workflow,
    stateId: string
  ): string;
}
```

The immediate priority is getting a clean, serializable, verifiable state-machine model that can later support both a visual editor and schema generation.
