import { describe, it } from 'vitest';

// Planning stubs for bead vkvw-bl2c — Discuss VK compile and hotswap strategy.
// These are intentionally pending: this slice establishes the implementation plan
// and the minimal interfaces; production behavior lands in follow-up slices.

describe('VK/VD coordinated hotswap planner', () => {
  it.todo('builds a plan that restarts VK before VD in the same coordinated flow');
  it.todo('requires the operator to choose the VK artifact source for each run');
  it.todo('rejects local Rust build fallback unless the operator explicitly allows it');
  it.todo('resolves GitHub prerelease assets by vk-assets-<full_vk_sha> and selected Linux platform');
  it.todo('validates VK manifest schema, release tag, commit, asset filename, and SHA256 before promotion');
  it.todo('validates the VD dist contract before any supervisor restart is attempted');
  it.todo('uses the injected SupervisorRestarter for vibe-kanban then vibe-dashboard restarts');
  it.todo('waits for VK readiness before promoting or restarting VD');
  it.todo('records rollback paths for VK binary/version marker and VD dist');
  it.todo('does not invoke the turn-continuity resume seam in the core hotswap flow yet');
});
