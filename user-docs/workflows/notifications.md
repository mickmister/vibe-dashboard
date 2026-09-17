# Workflow notifications

Workflow notifications tell you when workflow work reaches an important ending.

## Browser notifications

When browser notifications are enabled and allowed by your browser, Vibe Dashboard can notify you when a workflow run reaches a terminal state such as complete, blocked, or failed.

Notifications should include product-safe information:

- workflow name
- status
- short summary when available
- link back to the supported workflow page

Notifications should not include raw provider logs, local paths, shell output, queue details, webhook details, or internal IDs.

## Meta-workflow notifications

A meta-workflow coordinates an ordered list of bead-driven workflow items.

For meta-workflows, notifications should be aggregate-level:

- notify when the meta-workflow completes
- notify when the meta-workflow blocks or fails
- do not notify for every child workflow completion

This keeps long multi-bead runs from spamming the user.

## Permission and availability

Browser notifications require user permission. If permission is denied or unavailable, the product should explain that clearly and continue showing status in the Workflows UI.

Enabling notifications should not replay old historical workflow completions as new alerts. Notifications should focus on changes observed after notifications are enabled and the current view has loaded.
