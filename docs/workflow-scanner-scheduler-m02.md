# Workflow scanner and scheduler ownership primitives (M02)

M02 introduces VD-owned workflow scheduling read-model primitives without turning
on a background worker yet.

Ownership split:

- **VD** owns workflow scheduling policy: session ownership, active-execution
  budget, callback/CI waits, and future assignment eligibility.
- **VK** remains the execution/queue safety primitive and emergency brake. VD
  observes VK activity and queues through VK guarded `/queue` paths in later
  runtime slices.

`WorkflowActivityScanner.scanOnce()` is deterministic and read/model-only. It
combines:

- VD role/lane session bindings.
- VD active scoped triggers.
- VD explicit external waits (`WorkflowExternalWait`) for callback/CI ownership.
- VK activity snapshot and response-read APIs.

Classifications include `idle`, `queued_reserved`, `running`,
`waiting_on_callback`, `waiting_on_ci`, `completed_since_cursor`,
`failed_or_killed`, `stalled_needs_attention`, and `unknown_unreachable`.

Budget semantics:

- `running` consumes active-execution budget and owns the session.
- `queued_reserved` owns the session but does not consume execution budget.
- `waiting_on_callback` and `waiting_on_ci` own the session but do not consume
  execution budget unless VK also reports a running turn, or the watched exact
  execution is still running.
- `completed_since_cursor`, `failed_or_killed`, `stalled_needs_attention`, and
  `unknown_unreachable` conservatively keep ownership until a later worker/user
  handles the state. A stalled classification can still consume execution budget
  if VK reports the session is actively running.
- Only `idle` sessions are eligible for unrelated work.

This slice does not implement trigger satisfaction, response delivery,
fanout/fan-in, durable `send --respond`, factory assignment, templates, lane
execution, or UI.
