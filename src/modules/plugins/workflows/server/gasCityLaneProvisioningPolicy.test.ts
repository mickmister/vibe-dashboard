import { describe, expect, it } from 'vitest';
import { buildLaneCreateOffer, decideGasCityLaneProvisioning, type GasCityLaneCandidate } from './gasCityLaneProvisioningPolicy';

function lane(overrides: Partial<GasCityLaneCandidate> = {}): GasCityLaneCandidate {
  return {
    laneId: 'lane-a',
    label: 'Lane A',
    parentWorkspaceId: 'workspace-a',
    status: 'ready',
    worktreeStatus: 'clean',
    capacity: { write: { status: 'available' } },
    boundBeadIds: ['bead-a'],
    ...overrides,
  };
}

describe('Gas City lane provisioning policy GCW-13', () => {
  it('accepts an existing clean lane with available write capacity', () => {
    const decision = decideGasCityLaneProvisioning({
      workspaceId: 'workspace-a',
      sourceBeadId: 'bead-a',
      sourceBeadTitle: 'Implement thing',
      formula: 'review-flow',
      target: 'worker',
      existingLane: lane(),
    });

    expect(decision).toMatchObject({
      status: 'ready',
      reasonCode: 'lane_ready',
      lane: { laneId: 'lane-a', label: 'Lane A', status: 'ready' },
      offerCreate: null,
      cleanupPolicy: { mode: 'explicit_audit_only' },
    });
  });

  it('returns deterministic missing-lane offer-create metadata without creating a lane', () => {
    const first = decideGasCityLaneProvisioning({ workspaceId: 'workspace-a', sourceBeadId: 'bead-a', sourceBeadTitle: 'Add GC fanout', formula: 'review-flow', target: 'worker' });
    const second = decideGasCityLaneProvisioning({ workspaceId: 'workspace-a', sourceBeadId: 'bead-a', sourceBeadTitle: 'Add GC fanout', formula: 'review-flow', target: 'worker' });

    expect(first).toMatchObject({ status: 'offer_create', reasonCode: 'lane_missing', lane: null, message: 'Create or choose a clean lane before launching this task bead.' });
    expect(first.offerCreate).toEqual(second.offerCreate);
    expect(first.offerCreate).toMatchObject({ purpose: 'Isolated work for task bead bead-a.' });
    expect(JSON.stringify(first)).not.toMatch(/\/Users|\/tmp|node_modules|gc sling|bd show|git status|stdout|stderr|provider diagnostics/i);
  });

  it('blocks dirty held unknown wrong-workspace archived and quota-full lanes product-safely', () => {
    const base = { workspaceId: 'workspace-a', sourceBeadId: 'bead-a', formula: 'review-flow', target: 'worker' };
    expect(decideGasCityLaneProvisioning({ ...base, existingLane: lane({ worktreeStatus: 'dirty' }) })).toMatchObject({ status: 'blocked', reasonCode: 'lane_dirty' });
    expect(decideGasCityLaneProvisioning({ ...base, existingLane: lane({ capacity: { write: { status: 'held', ownerId: 'writer' } } }) })).toMatchObject({ status: 'blocked', reasonCode: 'lane_held' });
    expect(decideGasCityLaneProvisioning({ ...base, existingLane: lane({ worktreeStatus: 'unknown' }) })).toMatchObject({ status: 'blocked', reasonCode: 'lane_unknown' });
    expect(decideGasCityLaneProvisioning({ ...base, existingLane: lane({ parentWorkspaceId: 'workspace-b' }) })).toMatchObject({ status: 'blocked', reasonCode: 'lane_wrong_workspace' });
    expect(decideGasCityLaneProvisioning({ ...base, existingLane: lane({ status: 'archived' }) })).toMatchObject({ status: 'blocked', reasonCode: 'lane_archived' });
    expect(decideGasCityLaneProvisioning({ ...base, existingLane: lane(), quota: { activeLaneCount: 3, activeLaneLimit: 3 } })).toMatchObject({ status: 'blocked', reasonCode: 'quota_reached' });
  });

  it('defines dependency cache policy without exposing raw paths in product status', () => {
    expect(decideGasCityLaneProvisioning({ workspaceId: 'workspace-a', sourceBeadId: 'bead-a', formula: 'review-flow', target: 'worker', existingLane: lane(), dependencyCache: { packageManager: 'pnpm', hasPackageManagerStore: true } }).dependencyCache).toMatchObject({ mode: 'package_manager_store', safeToCopyNodeModules: false, summary: 'Reuse pnpm store/cache during lane provisioning before installing dependencies.' });
    expect(decideGasCityLaneProvisioning({ workspaceId: 'workspace-a', sourceBeadId: 'bead-a', formula: 'review-flow', target: 'worker', existingLane: lane(), dependencyCache: { hasNodeModules: true, copyNodeModules: true } }).dependencyCache).toMatchObject({ mode: 'copy_if_safe', safeToCopyNodeModules: true });
    expect(decideGasCityLaneProvisioning({ workspaceId: 'workspace-a', sourceBeadId: 'bead-a', formula: 'review-flow', target: 'worker', existingLane: lane(), dependencyCache: { hasPackageManagerStore: false } }).dependencyCache).toMatchObject({ mode: 'skip', safeToCopyNodeModules: false });
  });

  it('derives stable create/reuse keys from workspace bead formula and target', () => {
    const offer = buildLaneCreateOffer({ workspaceId: 'workspace-a', sourceBeadId: 'bead-a', sourceBeadTitle: 'Review paths /Users/me and raw XML', formula: 'review-flow', target: 'worker' });
    expect(offer?.laneId).toMatch(/^lane-bead-a-/);
    expect(offer?.workingBranch).toMatch(/^lane\/bead-a-/);
    expect(offer?.idempotencyKey).toBe('lane-create:workspace-a:bead-a:review-flow:worker');
    expect(JSON.stringify(offer)).not.toMatch(/\/Users|raw XML|<decision|stdout|stderr|provider diagnostics/i);
  });
});
