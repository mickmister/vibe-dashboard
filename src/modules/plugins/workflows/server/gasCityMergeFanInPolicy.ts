import { sanitizeGasCityProviderText, type GasCityOpaqueMetadata } from './gasCityWorkflowProvider';

export type GasCityMergeFanInStatus = 'ready' | 'waiting_for_checks' | 'blocked';
export type GasCityMergeFanInReason =
  | 'checks_passed'
  | 'checks_pending'
  | 'checks_failed'
  | 'lane_missing'
  | 'lane_not_clean'
  | 'merge_conflict'
  | 'target_unavailable'
  | 'manual_review_required';

export type GasCityMergeCheckStatus = 'passed' | 'pending' | 'failed' | 'skipped';

export interface GasCityMergeCheckResult {
  id: string;
  label: string;
  status: GasCityMergeCheckStatus;
  required?: boolean;
  summary?: string | null;
}

export interface GasCityMergeLaneResult {
  laneId: string;
  label?: string | null;
  status: 'completed' | 'active' | 'blocked' | 'failed' | 'unknown';
  worktreeStatus: 'clean' | 'dirty' | 'unknown' | 'pending';
  sourceBeadId: string;
  sourceBeadTitle?: string | null;
}

export interface GasCityMergeFanInPolicyInput {
  workspaceId: string;
  formula: string;
  targetBranch: string;
  lanes: GasCityMergeLaneResult[];
  checks: GasCityMergeCheckResult[];
  requireAllLanesClean?: boolean;
  requireManualReview?: boolean;
}

export interface GasCityMergeFormulaStepPlan {
  stepId: string;
  title: string;
  contract: 'graph.v2';
  after: 'all_required_checks_pass';
  effect: 'typed_auto_merge';
  targetBranchLabel: string;
  metadata: GasCityOpaqueMetadata;
}

export interface GasCityMergeFanInPolicyDecision {
  status: GasCityMergeFanInStatus;
  reasonCode: GasCityMergeFanInReason;
  message: string;
  requiredChecks: Array<{ id: string; label: string; status: GasCityMergeCheckStatus; summary: string }>;
  lanes: Array<{ laneId: string; label: string; sourceBeadId: string; status: string; worktreeStatus: string }>;
  formulaStep: GasCityMergeFormulaStepPlan;
  rollbackPolicy: {
    mode: 'block_and_preserve_lanes';
    summary: string;
  };
  auditPolicy: {
    mode: 'formula_step_and_bead_note';
    summary: string;
  };
}

export function decideGasCityMergeFanInPolicy(input: GasCityMergeFanInPolicyInput): GasCityMergeFanInPolicyDecision {
  const checks = sanitizeChecks(input.checks);
  const lanes = sanitizeLanes(input.lanes);
  const formulaStep = buildGasCityAutoMergeFormulaStep({
    workspaceId: input.workspaceId,
    formula: input.formula,
    targetBranch: input.targetBranch,
    requiredCheckIds: checks.filter((check) => check.required !== false).map((check) => check.id),
  });
  const base = {
    requiredChecks: checks.map((check) => ({ id: check.id, label: check.label, status: check.status, summary: check.summary ?? '' })),
    lanes: lanes.map((lane) => ({ laneId: lane.laneId, label: lane.label, sourceBeadId: lane.sourceBeadId, status: lane.status, worktreeStatus: lane.worktreeStatus })),
    formulaStep,
    rollbackPolicy: {
      mode: 'block_and_preserve_lanes' as const,
      summary: 'If merge cannot complete safely, preserve temporary lanes and block for review; do not delete worktrees automatically.',
    },
    auditPolicy: {
      mode: 'formula_step_and_bead_note' as const,
      summary: 'Record merge attempt, checks, result, and lane references through Gas City formula state and product-safe Beads notes.',
    },
  };

  if (input.requireManualReview) return decision('blocked', 'manual_review_required', 'Manual review is required before the merge step can run.', base);
  if (lanes.length === 0) return decision('blocked', 'lane_missing', 'No completed temporary lanes are available to merge.', base);
  const unsafeLane = lanes.find((lane) => lane.status !== 'completed' || (input.requireAllLanesClean !== false && lane.worktreeStatus !== 'clean'));
  if (unsafeLane) return decision('blocked', unsafeLane.worktreeStatus === 'clean' ? 'lane_missing' : 'lane_not_clean', 'All temporary lanes must be completed and clean before merge.', base);
  const failed = checks.find((check) => check.required !== false && check.status === 'failed');
  if (failed) return decision('blocked', 'checks_failed', 'Required checks failed; preserve lanes and block merge for review.', base);
  const pending = checks.find((check) => check.required !== false && check.status === 'pending');
  if (pending) return decision('waiting_for_checks', 'checks_pending', 'Waiting for required checks before merge.', base);
  return decision('ready', 'checks_passed', 'All required checks passed; the formula merge step may run.', base);
}

export function buildGasCityAutoMergeFormulaStep(input: { workspaceId: string; formula: string; targetBranch: string; requiredCheckIds: string[] }): GasCityMergeFormulaStepPlan {
  const workspaceId = sanitizeId(input.workspaceId, 'workspace');
  const formula = sanitizeId(input.formula, 'formula');
  const targetBranchLabel = sanitizeBranchLabel(input.targetBranch);
  const requiredCheckIds = input.requiredCheckIds.map((id) => sanitizeId(id, 'check')).sort();
  const checkHash = stableHash(requiredCheckIds.join(':'));
  return {
    stepId: `auto-merge-${formula}-${checkHash}`.slice(0, 120),
    title: 'Merge completed lane work after checks pass',
    contract: 'graph.v2',
    after: 'all_required_checks_pass',
    effect: 'typed_auto_merge',
    targetBranchLabel,
    metadata: {
      workspaceId,
      formula,
      requiredChecks: requiredCheckIds.join(','),
      targetBranchLabel,
    },
  };
}

function decision(
  status: GasCityMergeFanInStatus,
  reasonCode: GasCityMergeFanInReason,
  message: string,
  base: Omit<GasCityMergeFanInPolicyDecision, 'status' | 'reasonCode' | 'message'>,
): GasCityMergeFanInPolicyDecision {
  return { status, reasonCode, message: sanitizeGasCityProviderText(message, 'Merge status is unavailable.'), ...base };
}

function sanitizeChecks(checks: GasCityMergeCheckResult[]): Array<Required<Pick<GasCityMergeCheckResult, 'id' | 'label' | 'status'>> & { required?: boolean; summary?: string | null }> {
  return checks.map((check) => ({
    id: sanitizeId(check.id, 'check'),
    label: sanitizeGasCityProviderText(check.label, check.id),
    status: ['passed', 'pending', 'failed', 'skipped'].includes(check.status) ? check.status : 'pending',
    required: check.required !== false,
    summary: check.summary == null ? null : sanitizeGasCityProviderText(check.summary, 'Check status is available.'),
  }));
}

function sanitizeLanes(lanes: GasCityMergeLaneResult[]): Array<Required<GasCityMergeLaneResult> & { label: string }> {
  return lanes.map((lane) => ({
    laneId: sanitizeId(lane.laneId, 'lane'),
    label: sanitizeGasCityProviderText(lane.label ?? lane.laneId, lane.laneId),
    status: ['completed', 'active', 'blocked', 'failed', 'unknown'].includes(lane.status) ? lane.status : 'unknown',
    worktreeStatus: ['clean', 'dirty', 'unknown', 'pending'].includes(lane.worktreeStatus) ? lane.worktreeStatus : 'unknown',
    sourceBeadId: sanitizeId(lane.sourceBeadId, 'bead'),
    sourceBeadTitle: sanitizeGasCityProviderText(lane.sourceBeadTitle ?? lane.sourceBeadId, lane.sourceBeadId),
  }));
}

function sanitizeBranchLabel(value: string): string {
  return sanitizeGasCityProviderText(value.replace(/[^A-Za-z0-9._/-]+/g, '-'), 'feature branch').slice(0, 120);
}

function sanitizeId(value: string, fallback: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 160) || fallback;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
}
