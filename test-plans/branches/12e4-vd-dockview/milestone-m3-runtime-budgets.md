# DockView milestone M3.4 runtime budget test plan

- Milestone task: `vkvw-7t0c.4 — DockView M3.4 — Enforce global iframe and warm-Voyage budgets`
- Test-plan bead: `vkvw-7t0c.7 — DockView M3.4 QA — Approve and execute runtime budget test plan`
- Scope: window-global iframe runtime registry, warm Voyage controller cache, LRU
  eviction, visibility classification, and Split View lease/pin primitives; no
  M4 final workflow cutover
- Sources of truth:
  - `DOCKVIEW_IMPLEMENTATION_PLAN.md`
  - closed M1 Split View/iframe contract spikes
  - closed `vkvw-7t0c.1`, `vkvw-7t0c.2`, and `vkvw-7t0c.3`

## User stories

1. As a VD user, visible iframe-backed Panels stay alive even when total runtime
   count exceeds the configured budget.
2. As a VD user, returning to an inactive iframe that was evicted clearly reloads
   page-local state instead of silently pretending it was retained.
3. As a VD user switching between Voyages, the active and most-recent Voyage
   controllers remain warm by default without multiplying the single global
   iframe budget.
4. As a Split View user later in M4, runtime leases and controller pins have
   generation-checked ownership semantics ready to transfer payloads without
   moving Dockview renderer roots.

## Assumptions

- M3.4 may expose a focused production-shaped harness route for tester-visible
  budget and LRU evidence until M4 final navigation exists.
- Split View itself is not implemented here; M3.4 implements the lease, host,
  pin, and budget primitives M4 will use.
- Independent tester execution happens after code-review approval.

## Preconditions

- Work from the branch worktree with dependencies installed from the lockfile.
- Start from approved M3.1–M3.3 controller/coordinator/history behavior.
- Use actual iframe elements or the existing instrumented iframe runtime where
  browser identity, page-local state, and eviction/reload behavior matter.
- Use Chromium for browser evidence involving iframe identity, visibility, LRU,
  and controller switching.
- Do not commit `.playwright-cli`, screenshots, traces, or transcript scratch
  artifacts.

## Automated and manual acceptance cases

### TEST_CASE_M3_4A — Global runtime budget and visible-work protection

Steps:

1. Configure a small global iframe budget for the test.
2. Open enough iframe-backed Panels across one or more warm Voyages to exceed
   the budget.
3. Make some frames visible in the foreground Voyage and others hidden,
   background, or inactive.
4. Force budget reconciliation and inspect runtime registry state.

Expected:

- Budgeting is by stable runtime identity, not current attachment host.
- Every iframe counts once.
- Visible frames are never evicted.
- Inactive runtimes are evicted by global LRU until within budget or only
  visible frames remain.
- If visible frames alone exceed budget, the over-budget condition is exposed
  and no visible work is destroyed.
- Application `pinned` / non-closeable Panels are not runtime-retention
  exemptions when inactive.

Error cases:

- Budget set to zero or one.
- Missing runtime registration fails closed before attachment.
- Reconciliation after disposal is idempotent.

### TEST_CASE_M3_4B — Warm Voyage controller cache and lifecycle cleanup

Steps:

1. Open at least three Voyages with iframe-backed Panels.
2. Switch repeatedly between them using a warm Voyage limit of two.
3. Observe which controllers remain warm and which are evicted.
4. Reopen an evicted Voyage.

Expected:

- The active and most-recent Voyage controllers remain warm by default.
- Controller eviction flushes persistence through the M3 coordinator and tears
  down subscriptions exactly once.
- Controller eviction does not imply retaining all iframe runtimes from that
  Voyage; iframe entries remain subject to the global LRU.
- Reopening an evicted controller restores from normalized durable state.
- Repeated switching does not grow duplicate listeners, controller instances, or
  orphaned DOM nodes.

Error cases:

- Warm Voyage limit zero, one, two, and larger-than-open-count.
- Eviction while a coordinator flush is pending.
- Eviction failure leaves a typed recovery state rather than a half-warm
  controller.

### TEST_CASE_M3_4C — Iframe identity, reload disclosure, and LRU ordering

Steps:

1. Open instrumented iframe runtimes and record boot ID, heartbeat, form text,
   scroll position, URL/route, and listener count.
2. Make one runtime inactive and older than another inactive runtime.
3. Apply budget pressure.
4. Return to retained and evicted runtimes.

Expected:

- Retained runtimes keep boot ID, heartbeat continuity, form text, scroll, route,
  and listener count.
- Evicted runtimes dispose exactly once, stop heartbeats, and reload with a new
  boot ID when reopened.
- The UI or harness visibly discloses the reload boundary for evicted runtimes.
- LRU ordering uses runtime activity/visibility changes deterministically across
  warm Voyages.

Error cases:

- Evict a crashed or unresponsive iframe.
- Navigate or reload a runtime while it is inactive.
- Dispose and recreate the same Panel runtime without listener multiplication.

### TEST_CASE_M3_4D — Runtime attachment leases and host generation checks

Steps:

1. Create durable renderer hosts with generation-bearing host tokens.
2. Acquire an exclusive lease for a leaseable iframe runtime.
3. Attach the payload to a second application-owned host and then return it.
4. Replace or delete the original host while the lease is active.
5. Abort entry after acquiring one of two ordered leases.

Expected:

- A runtime has exactly one owner/attachment host at any instant.
- Lease acquisition is deterministic by stable runtime identity and rolls back
  in reverse order on failure.
- Host tokens include controller/Voyage identity, Panel identity, and renderer
  host generation.
- Reattach succeeds only to the current matching host generation.
- Deleted Panels/hosts remain authoritative; cleanup disposes or releases
  orphaned runtime ownership exactly once and never recreates deleted Panels.
- Dockview renderer roots, Panels, groups, and private DOM never move between
  controllers.

Error cases:

- Double release, double attach, stale host generation, controller replacement,
  and plugin/target removal during active lease.
- Split-only/recreatable runtime disposal on abort.

### TEST_CASE_M3_4E — Split View pin and foreground/background classification primitives

Steps:

1. Pin an invoking Voyage controller and acquire foreground runtime leases for
   two surfaces.
2. Mark foreground leased runtimes visible and the underlying Voyage runtimes
   application-inactive.
3. Apply controller-cache and iframe-budget pressure.
4. Release leases and pin on success, abort, route change, and teardown paths.

Expected:

- Invoking controller cannot be evicted while leases are active.
- Foreground leased runtimes count as visible work and are protected.
- Underlying Voyage frames become inactive for budget purposes while foreground
  surfaces are visible.
- Host transfer never double-counts the same stable runtime identity.
- Pins release exactly once after every successful, failed, aborted, and teardown
  cleanup path.

Error cases:

- Budget pressure while pinned.
- Abort after first lease attach and before second attach.
- Route change or component teardown during cleanup.

### TEST_CASE_M3_4F — Semantic browser runtime-budget workflow

Steps:

1. Open the approved M3.4 runtime-budget test surface through the product or
   approved harness route.
2. Use only labeled controls and real iframe/Dockview interactions to exercise
   budget pressure, Voyage switching, eviction/reopen, lease attach/return,
   host invalidation, and pin release.
3. Record visible status after each action: active Voyage, warm controllers,
   runtime count, visible/inactive runtimes, LRU order, pinned controllers,
   leases, evictions, boot IDs, and reload disclosures.

Expected:

- A tester can run the core budget and lease workflows without private object
  mutation or internal repair calls.
- Visible status updates only after the registry/coordinator publishes accepted
  state or typed recovery state.
- The manual transcript can be converted into focused Playwright coverage using
  the onboarding workflow.

## Agent-driven browser workflow

Use the Playwright CLI snapshot/ref loop from
`test-plans/onboarding/feature-work-process.md` for independent testing:

```bash
PW_SESSION='dockview-m3-4-<unique>'
pnpm playwright:cli -s="$PW_SESSION" open "$URL"
pnpm playwright:cli -s="$PW_SESSION" snapshot --json
pnpm playwright:cli -s="$PW_SESSION" generate-locator e<N> --json
pnpm playwright:cli -s="$PW_SESSION" click e<N> --json
```

Record exact commands, URLs, locator hints, screenshots if captured, and results
on the tester bead. Do not commit raw Playwright CLI artifacts.

## Required result schema

Implementation, review, and independent tester evidence should report:

```json
{
  "TEST_CASE_M3_4A": { "status": "PASS" },
  "TEST_CASE_M3_4B": { "status": "PASS" },
  "TEST_CASE_M3_4C": { "status": "PASS" },
  "TEST_CASE_M3_4D": { "status": "PASS" },
  "TEST_CASE_M3_4E": { "status": "PASS" },
  "TEST_CASE_M3_4F": { "status": "PASS" }
}
```

Allowed statuses: `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`.

## Overseer self-review notes

- The plan keeps M3.4 focused on runtime lifecycle, visibility, cache limits,
  LRU eviction, and lease/pin primitives.
- It excludes final M4 Split View/product workflow implementation while still
  requiring the primitives M4 depends on.
- It preserves the sequencing rule: implementation, code review, then
  independent tester before M4 starts.
