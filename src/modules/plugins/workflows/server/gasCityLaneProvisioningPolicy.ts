import { sanitizeGasCityProviderText } from './gasCityWorkflowProvider';

export type GasCityLaneProvisioningStatus = 'ready' | 'offer_create' | 'blocked';
export type GasCityLaneProvisioningReason =
  | 'lane_ready'
  | 'lane_missing'
  | 'lane_dirty'
  | 'lane_held'
  | 'lane_unknown'
  | 'lane_wrong_workspace'
  | 'lane_archived'
  | 'quota_reached';

export type GasCityDependencyCacheMode = 'package_manager_store' | 'copy_if_safe' | 'skip';

export interface GasCityLaneCandidate {
  laneId: string;
  label?: string | null;
  parentWorkspaceId: string;
  status: 'planned' | 'ready' | 'active' | 'paused' | 'blocked' | 'completed' | 'archived';
  worktreeStatus: 'pending' | 'clean' | 'dirty' | 'unknown';
  capacity?: {
    write?: {
      status: 'available' | 'held' | 'stale_or_orphan' | 'blocked';
      ownerId?: string | null;
    } | null;
  } | null;
  boundBeadIds?: string[];
}

export interface GasCityLaneProvisioningRequest {
  workspaceId: string;
  sourceBeadId: string;
  sourceBeadTitle?: string | null;
  formula: string;
  target: string;
  existingLane?: GasCityLaneCandidate | null;
  quota?: {
    activeLaneLimit?: number | null;
    activeLaneCount?: number | null;
  } | null;
  dependencyCache?: {
    packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'unknown';
    hasNodeModules?: boolean | null;
    hasPackageManagerStore?: boolean | null;
    copyNodeModules?: boolean | null;
  } | null;
}

export interface GasCityLaneProvisioningDecision {
  status: GasCityLaneProvisioningStatus;
  reasonCode: GasCityLaneProvisioningReason;
  lane: { laneId: string; label: string; status: 'ready' } | null;
  offerCreate: {
    laneId: string;
    name: string;
    purpose: string;
    workingBranch: string;
    idempotencyKey: string;
  } | null;
  dependencyCache: {
    mode: GasCityDependencyCacheMode;
    summary: string;
    safeToCopyNodeModules: boolean;
  };
  cleanupPolicy: {
    mode: 'explicit_audit_only';
    summary: string;
  };
  message: string;
}

export function decideGasCityLaneProvisioning(input: GasCityLaneProvisioningRequest): GasCityLaneProvisioningDecision {
  const workspaceId = sanitizeId(input.workspaceId);
  const sourceBeadId = sanitizeId(input.sourceBeadId);
  const formula = sanitizeId(input.formula);
  const target = sanitizeId(input.target);
  const offerCreate = buildLaneCreateOffer({ workspaceId, sourceBeadId, sourceBeadTitle: input.sourceBeadTitle, formula, target });
  const dependencyCache = dependencyCacheDecision(input.dependencyCache ?? null);
  const cleanupPolicy = {
    mode: 'explicit_audit_only' as const,
    summary: 'Temporary lane cleanup is explicit and audited after work is completed; this policy does not delete worktrees automatically.',
  };

  const quota = input.quota;
  if (typeof quota?.activeLaneLimit === 'number' && typeof quota.activeLaneCount === 'number' && quota.activeLaneLimit >= 0 && quota.activeLaneCount >= quota.activeLaneLimit) {
    return blocked('quota_reached', 'Lane capacity is full for this workspace.', null, null, dependencyCache, cleanupPolicy);
  }

  const lane = sanitizeLane(input.existingLane ?? null);
  if (!lane) {
    return {
      status: 'offer_create',
      reasonCode: 'lane_missing',
      lane: null,
      offerCreate,
      dependencyCache,
      cleanupPolicy,
      message: 'Create or choose a clean lane before launching this task bead.',
    };
  }
  if (lane.parentWorkspaceId !== workspaceId) return blocked('lane_wrong_workspace', 'Lane belongs to another workspace.', null, offerCreate, dependencyCache, cleanupPolicy);
  if (lane.status === 'archived') return blocked('lane_archived', 'Archived lanes cannot be used for new task work.', null, offerCreate, dependencyCache, cleanupPolicy);
  if (lane.worktreeStatus === 'dirty') return blocked('lane_dirty', 'Resolve lane changes before launching this task bead.', null, offerCreate, dependencyCache, cleanupPolicy);
  if (lane.worktreeStatus === 'unknown' || lane.worktreeStatus === 'pending') return blocked('lane_unknown', 'Refresh lane worktree status before launching this task bead.', null, offerCreate, dependencyCache, cleanupPolicy);
  if (lane.capacity?.write?.status === 'held') return blocked('lane_held', 'Lane is currently being used by another write operation.', null, offerCreate, dependencyCache, cleanupPolicy);
  if (lane.capacity?.write?.status === 'stale_or_orphan' || lane.capacity?.write?.status === 'blocked') return blocked('lane_unknown', 'Recover lane write capacity before launching this task bead.', null, offerCreate, dependencyCache, cleanupPolicy);
  return {
    status: 'ready',
    reasonCode: 'lane_ready',
    lane: { laneId: lane.laneId, label: lane.label, status: 'ready' },
    offerCreate: null,
    dependencyCache,
    cleanupPolicy,
    message: 'Lane is clean and ready for isolated task work.',
  };
}

export function buildLaneCreateOffer(input: { workspaceId: string; sourceBeadId: string; sourceBeadTitle?: string | null; formula: string; target: string }): GasCityLaneProvisioningDecision['offerCreate'] {
  const workspaceId = sanitizeId(input.workspaceId);
  const sourceBeadId = sanitizeId(input.sourceBeadId);
  const formula = sanitizeId(input.formula);
  const target = sanitizeId(input.target);
  const titleSlug = slugify(input.sourceBeadTitle ?? sourceBeadId).slice(0, 36) || sourceBeadId;
  const suffix = stableHash(`${workspaceId}:${sourceBeadId}:${formula}:${target}`);
  return {
    laneId: `lane-${sourceBeadId}-${suffix}`.slice(0, 120),
    name: `Task lane ${titleSlug}`.slice(0, 80),
    purpose: `Isolated work for task bead ${sourceBeadId}.`,
    workingBranch: `lane/${sourceBeadId}-${suffix}`.slice(0, 120),
    idempotencyKey: `lane-create:${workspaceId}:${sourceBeadId}:${formula}:${target}`.slice(0, 220),
  };
}

function dependencyCacheDecision(input: GasCityLaneProvisioningRequest['dependencyCache']): GasCityLaneProvisioningDecision['dependencyCache'] {
  if (!input) {
    return { mode: 'package_manager_store', summary: 'Use package-manager stores or install steps during lane provisioning; do not copy dependency folders by default.', safeToCopyNodeModules: false };
  }
  if (input.copyNodeModules === true && input.hasNodeModules === true) {
    return { mode: 'copy_if_safe', summary: 'Dependency folder copy may be used only by the typed lane provisioner with size and freshness checks.', safeToCopyNodeModules: true };
  }
  if (input.hasPackageManagerStore !== false) {
    const manager = input.packageManager && input.packageManager !== 'unknown' ? input.packageManager : 'package-manager';
    return { mode: 'package_manager_store', summary: `Reuse ${manager} store/cache during lane provisioning before installing dependencies.`, safeToCopyNodeModules: false };
  }
  return { mode: 'skip', summary: 'No dependency cache is available; lane provisioning should install dependencies normally.', safeToCopyNodeModules: false };
}

function blocked(
  reasonCode: GasCityLaneProvisioningReason,
  message: string,
  lane: GasCityLaneProvisioningDecision['lane'],
  offerCreate: GasCityLaneProvisioningDecision['offerCreate'],
  dependencyCache: GasCityLaneProvisioningDecision['dependencyCache'],
  cleanupPolicy: GasCityLaneProvisioningDecision['cleanupPolicy'],
): GasCityLaneProvisioningDecision {
  return { status: 'blocked', reasonCode, lane, offerCreate, dependencyCache, cleanupPolicy, message: sanitizeGasCityProviderText(message, 'Lane is not ready.') };
}

function sanitizeLane(lane: GasCityLaneCandidate | null): (GasCityLaneCandidate & { label: string }) | null {
  if (!lane) return null;
  const laneId = sanitizeId(lane.laneId);
  if (!laneId) return null;
  return {
    ...lane,
    laneId,
    parentWorkspaceId: sanitizeId(lane.parentWorkspaceId),
    label: sanitizeGasCityProviderText(lane.label ?? laneId, laneId),
    boundBeadIds: lane.boundBeadIds?.map(sanitizeId).filter(Boolean) ?? [],
  };
}

function sanitizeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 160);
}

function slugify(value: string): string {
  return sanitizeGasCityProviderText(value, 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'task';
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
}
