# Weekly dev branch process

Status: proposal captured for:

- `vkvw-n4sz` — Define weekly dev merge request process
- `vkvw-lnbo` — Plan feature branch archival after dev merge

This document captures the current proposed lifecycle for dogfooding feature work through a weekly dev branch. It intentionally supersedes the earlier default assumption that every soft merge into weekly dev should use a merge commit.

## Goals

- Keep dogfood branches visible and continuously validated.
- Avoid long-lived feature branches drifting far from weekly dev.
- Preserve an auditable copy of each feature branch before it is realigned.
- Make request-to-merge safer by simulating the merge before weekly integration.

## Proposed lifecycle

For a feature branch named `feature-x` and current weekly dev branch `dev`:

1. **Preflight before touching refs**
   - Fetch latest refs.
   - Confirm both worktrees are clean.
   - Run a simulated merge from `feature-x` into `dev` and report conflicts, changed files, and required validation.
   - Do not proceed to ref-changing commands if the simulated merge has conflicts or unclear validation requirements.

2. **Archive the feature branch**
   - Create the next available archive ref, e.g. `archive/feature-x/1`, then `/2`, etc.
   - The archive ref points at the pre-merge feature tip.
   - Push the archive ref before destructive realignment, when remote operations are authorized.

3. **Squash merge into weekly dev**
   - Merge `feature-x` into `dev` as a squash merge.
   - Write a thoughtful descriptive commit message summarizing the feature, validation, and any follow-up caveats.
   - This is a change from the earlier merge-commit default discussions.

4. **Validate weekly dev**
   - Run validation selected by the merge reviewer for the affected repo.
   - For VD, include targeted tests plus `npm run check-types`, `git diff --check`, and full `npm run test` when feasible.
   - For VK, prefer targeted tests around changed code plus the appropriate package checks or Rust checks; run broader checks when the change size/risk justifies it.

5. **Realign the feature branch**
   - After weekly dev validation passes and the merge commit is accepted, reset `feature-x` to match `dev` exactly so follow-up work starts from weekly dev.
   - This reset is destructive to the feature branch ref and should only run after the archive ref exists and the operator has authorized the exact commands.

## Request-to-merge preflight report

A merge candidate request should include:

- candidate bead name and branch
- candidate tip SHA and weekly dev tip SHA
- merge-base SHA
- simulated merge result: clean or conflict list
- changed-file summary
- likely validation commands
- whether archive/squash/reset operations are safe to proceed, or the exact blocker

## Safety notes

- Treat archive creation, squash commits, pushes, and feature branch resets as explicit operator-authorized operations.
- Do not blindly merge or reset branches from an automated request.
- If a candidate branch is already based on weekly dev and simulated merge is clean, the implementation can prepare validation and commands, but should still stop before destructive ref changes unless the human has authorized them.
