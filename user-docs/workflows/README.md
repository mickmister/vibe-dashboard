# Workflows overview

Workflows help a workspace coordinate repeatable work across people, agents, forms, and other workflows.

A workflow answers four product questions:

1. **What are we trying to do?** The run starts with task inputs, often including one or more bead IDs and titles.
2. **Who should act?** Each role describes a kind of work, such as Dev, Reviewer, Tester, or Form author.
3. **What happens next?** Each state is a stage of the workflow. A state can ask an agent to act, ask a person for input, or wait for another workflow.
4. **When are we done?** A terminal outcome means the workflow has finished normally. Failed or blocked outcomes mean someone needs to inspect or fix something.

## Common words

- **Workflow**: The reusable plan.
- **Run**: One execution of a workflow in a workspace.
- **Role**: A job in the workflow, such as Dev or Reviewer.
- **State**: The current stage of the workflow.
- **Step**: One piece of work inside a state.
- **Action**: The decision that moves the workflow from one state to another.
- **Loop**: An action that sends the workflow back to an earlier state for more work.
- **Waiting**: The workflow has sent work to an agent, person, or child workflow and is waiting for the result.
- **Blocked**: The workflow needs attention before it can continue safely.
- **Complete**: The workflow reached its normal ending.

## Bead context

When a run references beads, the workflow prompt includes a safe task summary with bead IDs and bead titles. Agents can use that context to understand the task. The prompt should not include raw provider logs, local paths, shell output, or transport details.

If an agent needs more information, it should use only the task context and any explicitly available typed bead tools.

## See also

- [How workflows move forward](progression.md)
- [Creating and customizing workflows](creation.md)
- [Workflow notifications](notifications.md)
