# How workflows move forward

This page explains workflow progress in plain English.

## The basic pattern

A workflow run moves through states. Each state belongs to a role and contains one or more steps.

A typical agent state works like this:

1. The workflow sends a prompt to the role's selected session.
2. The agent does the requested work or review.
3. If the step needs a structured decision, the agent returns one of the allowed actions.
4. The workflow follows that action to the next state.
5. The run page shows what was requested, who acted, what they replied, and what happens next.

## Agent turns

An **agent turn** is one message sent to an agent and the response that comes back.

There are two common kinds:

- **Work turn**: The agent performs or explains work. The workflow usually continues to a later decision step.
- **Decision turn**: The agent chooses one allowed action, such as `ready_for_review`, `needs_more_work`, or `approved`.

When a decision turn expects structured output, the prompt includes the exact response schema the agent should follow. Users should not have to write that schema manually for normal workflows.

## Actions and loops

An action moves the run to another state.

Examples:

- **Ready for review** moves from Dev to Review.
- **Approved** moves from Review to Tester or Done.
- **Needs more work** loops back to Dev so the issue can be fixed.

Loops are normal. They mean the workflow learned something and is sending work back to the right role.

## Dev / Review / Tester self-review loop

The built-in Dev / Review / Tester workflow includes a Dev self-review step.

The Dev role first implements the requested work. Then Dev reviews its own work without making more code changes during that review step.

Dev self-review can choose:

- **Ready for review**: send the work to Reviewer.
- **Needs more work**: record concerns and an actionable fix plan, then loop back to Dev implementation.

After a **Needs more work** decision, the next Dev implementation turn is where fixes should happen.

Reviewer and Tester can also send the workflow back to Dev when they find issues.

## Human-form waits

Some workflow states need human input. A human-form step creates an attention item and a form.

While waiting for the form:

- The workflow is paused safely.
- The Workflows page can show that input is needed.
- Submitting the form resumes the workflow.
- Old or stale submissions are rejected instead of moving the wrong run forward.

Human-form waits are normal workflow steps. They are not an error path.

## Workflow-call waits

A workflow can call another workflow as a child run.

For a blocking workflow call:

1. The parent run starts the child run.
2. The parent waits for that exact child run to finish.
3. The child result is recorded as product-level context.
4. The parent continues after the child is complete or blocks if the child cannot finish safely.

The run page should show the parent/child relationship with supported links when available.

## Terminal outcomes

A workflow can end in several user-visible ways:

- **Complete**: The workflow reached its normal ending.
- **Blocked / needs attention**: The workflow stopped safely and needs a person to decide what to do next.
- **Failed**: Something unrecoverable happened in the system or integration.

A complete workflow is not necessarily “approved by every human.” It means the workflow reached the terminal outcome defined by the workflow design.

## What should not appear in normal workflow views

Normal workflow pages and prompts should avoid implementation details such as queue IDs, webhook delivery details, raw provider logs, local paths, shell output, or internal database IDs. Those details belong only in diagnostics or developer tools when explicitly needed.
