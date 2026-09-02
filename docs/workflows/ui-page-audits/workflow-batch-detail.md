# `/dashboard/workflow-batches/:batchId` — workflow batch detail

## Current role

Shows progress for batch-launched workflow items, capacity/backpressure, filters for item status, and links to child run story pages when available.

## UX issues

- **The page is read-only even when things fail.** It explicitly says retry/cancel controls are deferred, leaving users without recovery actions.
- **Capacity and backpressure are technical.** Users need to know whether the batch is healthy, waiting normally, or stuck.
- **Filters are button-only local state.** The URL does not reflect the filter, so filtered views cannot be shared.
- **The current item is inferred but not emphasized enough.** For long batches, users need “what is running now?” and “what is blocked?” first.
- **Line numbers may not map to user mental models.** If batch items came from pasted rows or selected beads, show that source context.
- **No timeline.** A batch can be waiting due to capacity; users need start, last advance, next retry/check, and completion estimates.

## Potential improvements

- Add a top “Batch health” card with plain-language state and next expected movement.
- Promote current/blocked item before aggregate capacity details.
- Put filter in the URL and add quick filters for “needs action” and “running now”.
- Add retry/cancel/skip designs, even if disabled with explanation until semantics land.
- Show source input name, row content, and workflow version per item.
- Add event timeline for batch scheduler decisions and capacity changes.
