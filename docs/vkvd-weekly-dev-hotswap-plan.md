# VK/VD weekly-dev hotswap implementation plan

Status: planning slice for bead vkvw-bl2c — Discuss VK compile and hotswap strategy.

This plan covers the smallest merge-safe path from the existing hotswap seams toward a coordinated VK then VD hotswap in the weekly-dev container. It intentionally does not implement production hotswap behavior yet.

## Researched local contracts

### VK release/prerelease artifacts

VK release assets are produced by `Vktest/.github/workflows/release-binaries.yml`.

- Triggered for pushes to any branch, tags, and manual dispatch with an optional `vk_ref`.
- Resolves a branch, tag, or SHA to a full VK commit SHA.
- Publishes a prerelease tag named `vk-assets-<full_vk_sha>`.
- The release contains:
  - `manifest.json`
  - `vibe-kanban-linux-x64.tar.gz` plus `.sha256`
  - `vibe-kanban-linux-arm64.tar.gz` plus `.sha256`
  - `vibe-kanban-macos-arm64.tar.gz` plus `.sha256`
- The manifest uses `schema_version: 1`, records both `release_tag` and `commit`, and has per-platform `assets.vibe-kanban.file`, `download_url`, `sha256`, and `archive_format` fields.
- Runtime contract: each archive contains a single executable named `vibe-kanban`; the local VK web UI is embedded into that executable.

VD already consumes those assets in `Dockerfile.vkvd` by downloading `https://github.com/mickmister/vibe-kanban/releases/download/vk-assets-${VK_COMMIT}/manifest.json`, validating schema/mode/tag/commit, selecting `linux-x64` or `linux-arm64`, verifying SHA256, extracting `vibe-kanban`, installing it to `/usr/local/bin/vibe-kanban`, and writing `/usr/local/share/vibe-kanban-build-version`.

### Local VK build fallback

VK local build paths exist but are heavier than artifact install:

- `Vktest/package.json` has `build:npx` via `local-build.sh`.
- `local-build.sh` builds the local web app, then runs Rust release builds and packages zip files for the NPX distribution.
- `Vktest/Dockerfile` also builds the web UI and Rust server binary locally.
- The release workflow uses nightly Rust, target-specific builds, Zig/cargo-zigbuild for Linux musl, and CI caches.

Policy update after the weekly-dev disk exhaustion incident: do not use local VK release builds as the default workflow. Local Rust build remains an emergency/manual fallback only, must require explicit operator allowance, and should be avoided in the weekly-dev container because it is slow, environment-sensitive, disk-heavy, and does not have the same prevalidated release-artifact contract. For normal VK hotswap prep, push the source commit and consume the CI prerelease asset keyed by the VK commit SHA.

### VD hotswap and supervisord

VD already has `scripts/hotswap-dashboard-dist.sh`.

- It validates a built VD `dist` folder.
- It snapshots the current runtime dist.
- It atomically replaces `/home/vkuser/.local/share/vibe-dashboard-runtime/dist`.
- It restarts the `vibe-dashboard` supervisord program.
- It rolls back the dist if restart fails.

`supervisord.vkvd.conf` defines the coordinated runtime programs:

- `vibe-kanban` runs `/usr/local/bin/vibe-kanban`, with `VK_BUILD_VERSION_FILE=/usr/local/share/vibe-kanban-build-version`.
- `vibe-dashboard` runs `node dist/node/node-entry.mjs` from `/home/vkuser/.local/share/vibe-dashboard-runtime`.

The approved hotswap seam from vkvw-yjxc added `SupervisorProgramRestarter`, which safely calls `supervisorctl` through injected `execFile` argv instead of shell interpolation.

## Human decisions to honor

- The operator chooses the artifact source each time.
- GitHub prerelease by branch or commit is the preferred CI artifact source option.
- Local Rust build is fallback only and requires explicit operator allowance.
- The first real flow coordinates VK then VD in one container flow.
- Reuse the injected supervisord runner seam.
- Defer turn resume integration for this task; treat the approved turn-continuity seam as separate safety plumbing.

## Smallest implementation shape

### Core interfaces

Add a small orchestration module that is injectable and testable:

1. `VkArtifactSource`
   - `github-prerelease`: repository, ref or commit SHA, desired platform.
   - `local-rust-build`: worktree path, desired platform, and `operatorAllowed: true`.
2. `VkRuntimeArtifactResolver`
   - resolves operator source choice into a staged executable, build-version label, manifest metadata, and provenance.
3. `RuntimePromoter`
   - promotes a staged VK binary or VD dist into its runtime path with rollback metadata.
4. `ReadinessProbe`
   - validates VK and VD after their restarts.
5. `VkvdHotswapCoordinator`
   - builds a plan and, in a later slice, applies it in this order:
     1. resolve/stage VK runtime
     2. validate/stage VD dist
     3. promote VK binary and version marker
     4. restart `vibe-kanban` through `SupervisorProgramRestarter`
     5. wait for VK readiness
     6. promote VD dist
     7. restart `vibe-dashboard` through `SupervisorProgramRestarter`
     8. wait for VD readiness
     9. record result and rollback pointers

### Missing orchestration around the injected supervisord runner

`SupervisorProgramRestarter` only performs the primitive operation: restart one supervisor program safely. The missing orchestration is everything around that primitive:

- source selection and operator policy enforcement
- GitHub release ref resolution and manifest validation
- artifact download, checksum verification, extraction, and executable validation
- optional local build execution with an explicit allow flag
- staging directories and atomic promotion into runtime paths
- rollback snapshots for VK binary/version marker and VD dist
- ordering: VK restart/readiness must succeed before VD restart proceeds
- readiness probes beyond “process restarted”
- durable hotswap state and audit trail
- clear failure policy and rollback attempts
- later, optional handoff to the agent-continuity safety seam

### Reusing injected runner vs alternatives

#### Reuse injected `SupervisorProgramRestarter`

Pros:

- Already reviewed and approved in VD hotswap seam work.
- Testable with an injected command runner; no shell interpolation.
- Keeps restart behavior in TypeScript with the rest of the hotswap policy and state machine.
- Lets tests assert restart ordering for `vibe-kanban` then `vibe-dashboard`.
- Easier to integrate later with VD admin actions or a detached VD-initiated runner.

Cons:

- Needs new orchestration code for staging, rollback, readiness, and state.
- True VD self-restart still requires a detached runner process, because in-process VD code cannot continue after restarting `vibe-dashboard`.
- Must carefully avoid doing long-running or privileged file operations directly inside request handlers.

#### Standalone shell script

Pros:

- Operationally simple to invoke manually.
- Shell is convenient for file promotion and calls to `curl`, `tar`, and `supervisorctl`.
- Similar to existing VD-only script.

Cons:

- Harder to unit test safely.
- Policy tends to become stringly typed and harder to inject/mocking command behavior.
- More risk of shell quoting mistakes unless very carefully constrained.
- Harder to share logic with future VD UI/API actions.

#### Manual restart initially

Pros:

- Lowest implementation effort.
- Useful as an emergency fallback/runbook.

Cons:

- Not repeatable enough for weekly dogfooding.
- Cannot enforce artifact/source policies.
- Higher operator-error risk around VK/VD ordering, rollback, and readiness checks.
- Does not move toward a real hotswap system.

## Recommended implementation phases

### Phase 1: Plan and interfaces, this slice

- Add minimal TypeScript interfaces for source choice, artifact resolution, promotion, readiness, and coordinator dependencies.
- Add pending Vitest stubs that lock in the intended behavior without implementing it yet.
- Keep turn resume out of the coordinator for now.

### Phase 2: CLI planning and local-build adapter

- Add a CLI-only entry point, exposed as `npm run hotswap:vkvd -- ...`.
- Keep dry-run as the safe default.
- Require `apply --confirm-non-dry-run` before any non-dry-run orchestration can execute.
- Implement the VK then VD coordinator against injected dependencies so tests can verify ordering without touching real runtime files or supervisord.
- Validate that local build source is rejected unless `operatorAllowed` is true.
- Add the first real VK artifact resolver for `local-rust-build`, still protected by `--allow-local-rust-build`. The adapter runs VK `local-build.sh`, stages the resulting `target/release/server` binary as `vibe-kanban`, makes it executable, and records its SHA256.
- Wire local-build source into dry-run output and the apply path; the remaining promotion, restart, and readiness adapters stay injected and test-only until follow-up slices.
- Validate GitHub prerelease manifest shape from fixture data in the GitHub resolver follow-up.

### Phase 3: Artifact resolver

- Implement GitHub prerelease resolver for `vk-assets-<full_vk_sha>`.
- Resolve a branch/ref to full commit when needed.
- Download manifest, select platform, verify checksum, extract executable to staging.
- Add no-network unit tests by injecting HTTP/download/fs seams.

### Phase 4: Runtime promotion

- Implement VK binary/version-marker promotion with backup and rollback.
- Reuse or refactor VD dist promotion behavior from `scripts/hotswap-dashboard-dist.sh` into a testable TypeScript seam or a safely invoked script wrapper.

### Phase 5: Coordinated apply runner

- Apply VK then VD in a detached runner process initiated by VD or by CLI.
- Restart via `SupervisorProgramRestarter`.
- Probe readiness after each restart.
- Persist state and rollback information.

### Phase 6: Optional continuity integration

- Integrate the vkvw-yjxc turn-continuity seam as a safety step once the core VK/VD runtime hotswap is stable.

## Open question before implementation beyond stubs

Should the first runnable entry point be CLI-only, or should VD immediately expose an admin action that spawns a detached runner? CLI-only is lower risk for the first real apply slice; admin action is nicer for dogfooding but requires request lifecycle and auth/operator safety decisions.

## VD runtime data safety finding

Springboard's Node runtime defaults persistent storage under the process working directory unless overridden:

- `SQLITE_DATABASE_FILE` defaults to `data/kv.db`.
- `NODE_KV_STORE_DATA_FILE` defaults to `./data/kv_data.json`.

In the weekly dev supervisord layout, `vibe-dashboard` runs from `/home/vkuser/.local/share/vibe-dashboard-runtime`, so the existing default persistent data paths live under sibling paths such as `/home/vkuser/.local/share/vibe-dashboard-runtime/data/kv.db` and `/home/vkuser/.local/share/vibe-dashboard-runtime/data/kv_data.json`.

The TypeScript VD runtime promoter only promotes and rolls back `/home/vkuser/.local/share/vibe-dashboard-runtime/dist`. It stages replacements as a hidden sibling of `dist`, moves the prior `dist` into the hotswap state directory, and never removes or copies the runtime directory itself. Tests cover that representative runtime data files under `runtimeDir/data` survive promote, rollback, and failed replacement restoration.


## VK build artifact policy update

A local VK release build during weekly-dev integration exhausted the container filesystem after old Cargo target outputs accumulated under multiple worktrees. After cleanup, disk usage dropped from roughly 99% to 54% with about 143 GB free. The operating assumption is now:

- local VK work in the weekly-dev container is limited to quick checks and focused validation;
- VK release/build artifact generation is offloaded to CI;
- the hotswap flow should use GitHub prerelease assets produced by `Vktest/.github/workflows/release-binaries.yml`, keyed by the source commit SHA;
- local prebuilt/local Rust artifact paths remain available only as explicit fallback tools, not the planned path.

This means future VK hotswap retry plans should wait for or trigger CI release assets, verify `manifest.json` and asset SHA256, then run VK-only hotswap from the downloaded artifact. Do not queue local `cargo build --release`, `local-build.sh`, or `pnpm run build:npx` for VK weekly-dev hotswap unless a human explicitly approves the disk/time risk for that specific run.

## CI-generated artifact maintenance plan

Generated artifacts such as `shared/types.ts` and `crates/db/.sqlx/**` should be maintained by CI instead of relying on agents to run heavyweight local regeneration in weekly-dev containers. The proposed CI job should:

1. run on manual dispatch and/or an explicit maintenance label;
2. check out the requested branch with write credentials;
3. use the same Node, pnpm, Rust, SQLx CLI, and disk-space setup as VK backend schema checks;
4. run `pnpm run generate-types` and `pnpm run prepare-db`;
5. fail if unexpected files changed;
6. commit only allowlisted generated paths when stale outputs are detected;
7. push the update to the same branch or open a small generated-artifacts PR if branch protection requires it;
8. re-run normal validation against the generated-artifacts commit.

Initial allowlist: `shared/types.ts` and `crates/db/.sqlx/**`. Remote generated outputs can be added later after review.

### Phase 1 VK hotswap permissions

The weekly-dev container runs VK and VD as `vkuser` under supervisord, but the initial VK runtime binary and version marker are seeded into `/usr/local`. For the Phase 1 hotswap path, Dockerfile.vkvd deliberately makes only `/usr/local/bin/vibe-kanban`, `/usr/local/share/vibe-kanban-build-version`, and `/var/lib/vd/hotswap/vk` writable by `vkuser:vkadmin`. The Dockerfile already has broader `vkadmin`-oriented writability for selected tool/runtime areas under `/usr/local`; this hotswap change should not broaden that surface to whole directories such as `/usr/local/bin` or `/usr/local/share`.

Security tradeoff: allowing `vkuser` to overwrite the VK binary weakens the root/vkuser boundary for that specific executable, but it keeps the mutable surface narrow and matches the current hotswap coordinator defaults. A future hardening pass should move the mutable VK runtime to a `vkuser`-owned directory such as `/home/vkuser/.local/share/vibe-kanban-runtime` and keep `/usr/local` as immutable seed/tooling state.
