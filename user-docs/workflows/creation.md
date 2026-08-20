# Creating and customizing workflows

Use the Workflows area to create, copy, customize, publish, and run workflows.

## Three ways to start

### Starter templates

Starter templates are built-in starting points. They are immutable: using one creates your own editable workflow draft.

Use a starter when you want a known-good shape, such as Dev / Review / Tester or Create form from agent.

### Duplicate an existing workflow

Duplicating an existing workflow copies the workflow design only.

The copy keeps links to role templates, prompt assets, and skill snippets. It does not copy runs, sessions, history, or library assets.

Use duplicate when you want a variation of a workflow that already exists.

### Blank draft

A blank draft starts truly empty:

- no roles
- no states
- no inputs
- no steps
- no actions
- no transitions

Blank drafts can be saved while incomplete. They cannot be published or run until validation passes.

Use blank only when you want to design the structure yourself.

## Drafts, publishing, and running

- **Draft**: editable and allowed to be incomplete.
- **Published version**: immutable and runnable.
- **Run**: a workspace-specific execution of a published version.

You can save an invalid draft while editing. Publishing is blocked until the workflow is valid. Running is only available for published workflows.

## Role templates

Role templates are reusable role definitions. A role template can include:

- role name and purpose
- base instructions
- attached prompt assets
- attached skill snippets
- executor/model defaults when configured

Workflows link to role template versions so published workflow runs are auditable. A run resolves the exact content it used into its snapshot.

## Prompt assets

Prompt assets are reusable instruction blocks. Use them for behavior that should be shared across workflows, such as how to review code or how to produce a planning summary.

Actual agent prompts should contain the resolved prompt text, not raw asset labels or version clutter.

## Skill snippets

Skill snippets are Markdown instructions. They are not executable tools by themselves.

Use skill snippets for reusable guidance, such as how to write a beads form or how to format a concise test report.

## Workflow inputs and bead context

Workflow inputs are the information a run needs at launch time. A run may also include one or more beads as task context.

When beads are selected, prompts should include a minimal, safe summary with bead IDs and titles. Detailed task information should live in the bead itself and be fetched only through supported typed tools when available.

## Dev / Review / Tester template

The Dev / Review / Tester starter includes:

1. Dev implementation.
2. Dev self-review.
3. Review.
4. Tester.
5. Loops back to Dev when self-review, review, or testing finds more work.

During Dev self-review, Dev should not make code changes. Dev should review, return the workflow decision, and wait for the next workflow instruction before making fixes.

## Advanced diagnostics

Advanced diagnostics may show workflow JSON, generated response schemas, validation details, or provenance. These are for troubleshooting and audit, not normal authoring flow.
