import { describe, expect, it } from 'vitest';
import { buildGasCityAutoMergeFormulaStep, decideGasCityMergeFanInPolicy, type GasCityMergeLaneResult } from './gasCityMergeFanInPolicy';

function lane(overrides: Partial<GasCityMergeLaneResult> = {}): GasCityMergeLaneResult {
  return {
    laneId: 'lane-a',
    label: 'Lane A',
    status: 'completed',
    worktreeStatus: 'clean',
    sourceBeadId: 'bead-a',
    sourceBeadTitle: 'Task A',
    ...overrides,
  };
}

const base = {
  workspaceId: 'workspace-a',
  formula: 'review-flow',
  targetBranch: 'vk/8b79-vd-workflows',
  lanes: [lane()],
  checks: [
    { id: 'review-approved', label: 'Review approved', status: 'passed' as const, required: true },
    { id: 'tests-pass', label: 'Tests pass', status: 'passed' as const, required: true },
  ],
};

describe('Gas City auto-merge fan-in policy GCW-12', () => {
  it('allows formula merge step only after all required checks pass and lanes are clean', () => {
    const decision = decideGasCityMergeFanInPolicy(base);

    expect(decision).toMatchObject({
      status: 'ready',
      reasonCode: 'checks_passed',
      message: 'All required checks passed; the formula merge step may run.',
      formulaStep: {
        contract: 'graph.v2',
        after: 'all_required_checks_pass',
        effect: 'typed_auto_merge',
        targetBranchLabel: 'vk/8b79-vd-workflows',
      },
      rollbackPolicy: { mode: 'block_and_preserve_lanes' },
      auditPolicy: { mode: 'formula_step_and_bead_note' },
    });
  });

  it('waits for pending checks and blocks failed checks without deleting lanes', () => {
    expect(decideGasCityMergeFanInPolicy({ ...base, checks: [{ id: 'tests', label: 'Tests', status: 'pending', required: true }] })).toMatchObject({
      status: 'waiting_for_checks',
      reasonCode: 'checks_pending',
      rollbackPolicy: { summary: expect.stringContaining('do not delete worktrees automatically') },
    });
    expect(decideGasCityMergeFanInPolicy({ ...base, checks: [{ id: 'tests', label: 'Tests', status: 'failed', required: true }] })).toMatchObject({
      status: 'blocked',
      reasonCode: 'checks_failed',
    });
  });

  it('blocks missing, active, or dirty temporary lanes before merge', () => {
    expect(decideGasCityMergeFanInPolicy({ ...base, lanes: [] })).toMatchObject({ status: 'blocked', reasonCode: 'lane_missing' });
    expect(decideGasCityMergeFanInPolicy({ ...base, lanes: [lane({ status: 'active' })] })).toMatchObject({ status: 'blocked', reasonCode: 'lane_missing' });
    expect(decideGasCityMergeFanInPolicy({ ...base, lanes: [lane({ worktreeStatus: 'dirty' })] })).toMatchObject({ status: 'blocked', reasonCode: 'lane_not_clean' });
  });

  it('keeps formula step metadata deterministic and side-effect free', () => {
    const first = buildGasCityAutoMergeFormulaStep({ workspaceId: 'workspace-a', formula: 'review-flow', targetBranch: 'vk/feature', requiredCheckIds: ['b', 'a'] });
    const second = buildGasCityAutoMergeFormulaStep({ workspaceId: 'workspace-a', formula: 'review-flow', targetBranch: 'vk/feature', requiredCheckIds: ['a', 'b'] });

    expect(first).toEqual(second);
    expect(first.stepId).toMatch(/^auto-merge-review-flow-/);
  });

  it('scrubs product output and never exposes raw commands, paths, stdout/stderr, or diagnostics', () => {
    const decision = decideGasCityMergeFanInPolicy({
      ...base,
      targetBranch: 'vk/feature; git merge /Users/me/secret',
      lanes: [lane({ label: 'Run git merge /tmp/lane with stdout provider diagnostics', worktreeStatus: 'dirty' })],
      checks: [{ id: 'ci', label: 'gc sling && bd show', status: 'failed', summary: 'stderr raw XML <decision/> webhook provider diagnostics /private/var/log' }],
    });

    expect(JSON.stringify(decision)).not.toMatch(/git merge|gc sling|bd show|\/Users|\/tmp|\/private\/var|stdout|stderr|provider diagnostics|raw XML|webhook|<decision/i);
  });
});
