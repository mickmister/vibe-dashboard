import { randomUUID } from 'node:crypto';
import type { Insertable, Kysely, Selectable } from 'kysely';
import type {
  DB,
  WorkspaceLane,
  WorkspaceLaneAccessMode,
  WorkspaceLaneBinding,
  WorkspaceLaneBindingType,
  WorkspaceLaneCapacityLease,
  WorkspaceLaneCapacityLeaseStatus,
  WorkspaceLaneStatus,
  WorkspaceLaneWorktreeStatus,
} from '../store/kysely_types';

export type LaneErrorCode =
  | 'parent_workspace_not_found'
  | 'lane_not_found'
  | 'lane_wrong_workspace'
  | 'lane_duplicate'
  | 'lane_archived'
  | 'lane_capacity_conflict'
  | 'lane_capacity_stale_or_orphan'
  | 'lane_binding_conflict'
  | 'lane_invalid_status'
  | 'lane_write_blocked';

export class LaneStoreError extends Error {
  readonly code: LaneErrorCode;
  readonly status: number;

  constructor(code: LaneErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'LaneStoreError';
    this.code = code;
    this.status = status;
  }
}

export interface LaneReadModel {
  laneId: string;
  parentWorkspaceId: string;
  isSubWorkspace: true;
  name: string;
  purpose: string;
  label: string;
  breadcrumb: string;
  status: WorkspaceLaneStatus;
  sourceBranch: string;
  workingBranch: string | null;
  worktree: {
    status: WorkspaceLaneWorktreeStatus;
    summary: Record<string, unknown> | null;
    display: string;
  };
  capacity: LaneCapacityReadModel;
  boundRunIds: string[];
  boundBeadIds: string[];
  bindings: LaneBindingReadModel[];
  provenance: LaneProvenance;
  nextAction: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  lastActiveRunId: string | null;
}

export interface LaneCapacityReadModel {
  write: {
    status: 'available' | 'held' | 'stale_or_orphan' | 'blocked';
    activeLeaseId: string | null;
    ownerId: string | null;
    acquiredAt: number | null;
    expiresAt: number | null;
    reason: string | null;
    recoveryPolicy: 'manual_release_or_owner_fenced_reclaim';
  };
}

export interface LaneBindingReadModel {
  bindingId: string;
  laneId: string;
  parentWorkspaceId: string;
  bindingType: WorkspaceLaneBindingType;
  bindingKey: string;
  reason: string | null;
  accessMode: WorkspaceLaneAccessMode;
  roleBindings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface LaneProvenance {
  laneId: string;
  laneLabel: string;
  parentWorkspaceId: string;
  parentBreadcrumb: string;
  cwdMode: 'parent_workspace' | 'sub_workspace_lane';
  selectedWorkspaceId: string;
}

export interface LaneAuditEventReadModel {
  auditId: string;
  laneId: string;
  parentWorkspaceId: string;
  eventType: string;
  actorId: string | null;
  message: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface ParentLaneOverviewModel {
  parentWorkspaceId: string;
  lanes: LaneReadModel[];
  counts: Record<WorkspaceLaneStatus, number>;
  activeWriteLanes: number;
  nextAction: string;
}

export interface SelectedLaneWorkspaceContext {
  workspaceId: string;
  parentWorkspaceId: string;
  laneId: string | null;
  laneLabel: string;
  cwdMode: 'parent_workspace' | 'sub_workspace_lane';
  allowsWrites: boolean;
  provenance: LaneProvenance | { laneId: null; laneLabel: 'Parent workspace'; parentWorkspaceId: string; parentBreadcrumb: string; cwdMode: 'parent_workspace'; selectedWorkspaceId: string };
}

export interface CreateLaneInput {
  laneId?: string;
  parentWorkspaceId: string;
  name: string;
  purpose: string;
  status?: WorkspaceLaneStatus;
  sourceBranch: string;
  workingBranch?: string | null;
  worktreePath?: string | null;
  worktreeStatus?: WorkspaceLaneWorktreeStatus;
  worktreeSummary?: Record<string, unknown> | null;
  createdBy?: Record<string, unknown>;
  cleanupPolicy?: Record<string, unknown>;
}

export interface BindLaneInput {
  bindingId?: string;
  parentWorkspaceId: string;
  laneId: string;
  bindingType: WorkspaceLaneBindingType;
  bindingKey: string;
  reason?: string | null;
  accessMode?: WorkspaceLaneAccessMode;
  roleBindings?: Record<string, unknown>;
}

export interface AcquireWriteTokenInput {
  parentWorkspaceId: string;
  laneId: string;
  leaseId?: string;
  ownerId: string;
  leaseDurationMs?: number | null;
  metadata?: Record<string, unknown>;
}

export interface DbWorkspaceLaneStoreOptions {
  db?: Kysely<DB>;
  getDb?: () => Promise<Kysely<DB>> | Kysely<DB>;
  now?: () => number;
  parentWorkspaceExists?: (workspaceId: string) => boolean | Promise<boolean>;
}

const FINAL_STATUSES: WorkspaceLaneStatus[] = ['completed', 'archived'];
const MUTABLE_STATUSES: WorkspaceLaneStatus[] = ['planned', 'ready', 'active', 'paused', 'blocked', 'completed', 'archived'];

export class DbWorkspaceLaneStore {
  private readonly getDbHandle: () => Promise<Kysely<DB>> | Kysely<DB>;
  private readonly now: () => number;
  private readonly parentWorkspaceExists?: (workspaceId: string) => boolean | Promise<boolean>;

  constructor(options: DbWorkspaceLaneStoreOptions) {
    if (!options.db && !options.getDb) throw new Error('DbWorkspaceLaneStore requires db or getDb');
    this.getDbHandle = options.getDb ?? (() => options.db as Kysely<DB>);
    this.now = options.now ?? Date.now;
    this.parentWorkspaceExists = options.parentWorkspaceExists;
  }

  async createLane(input: CreateLaneInput): Promise<LaneReadModel> {
    await this.assertParentExists(input.parentWorkspaceId);
    const laneId = clean(input.laneId) ?? randomUUID();
    const now = this.now();
    const row = {
      laneId,
      parentWorkspaceId: cleanRequired(input.parentWorkspaceId, 'parent workspace'),
      name: cleanRequired(input.name, 'lane name'),
      purpose: cleanRequired(input.purpose, 'lane purpose'),
      status: input.status ?? 'planned',
      sourceBranch: cleanRequired(input.sourceBranch, 'source branch'),
      workingBranch: clean(input.workingBranch),
      worktreePath: clean(input.worktreePath),
      worktreeStatus: input.worktreeStatus ?? 'pending',
      worktreeSummaryJson: input.worktreeSummary ? JSON.stringify(input.worktreeSummary) : null,
      createdByJson: JSON.stringify(input.createdBy ?? { type: 'unknown' }),
      cleanupPolicyJson: JSON.stringify(input.cleanupPolicy ?? { archivePreservesAudit: true, destructiveCleanupRequiresApproval: true }),
      createdAt: now,
      updatedAt: now,
      archivedAt: input.status === 'archived' ? now : null,
      lastActiveRunId: null,
    } satisfies Insertable<WorkspaceLane>;
    if (!MUTABLE_STATUSES.includes(row.status)) throw new LaneStoreError('lane_invalid_status', `Lane status ${row.status} is not supported.`);
    const db = await this.getDb();
    const existingId = await db.selectFrom('WorkspaceLane').select('laneId').where('laneId', '=', laneId).executeTakeFirst();
    if (existingId) throw new LaneStoreError('lane_duplicate', 'A lane with this id already exists.', 409);
    const existingName = await db.selectFrom('WorkspaceLane').select('laneId').where('parentWorkspaceId', '=', row.parentWorkspaceId).where('name', '=', row.name).executeTakeFirst();
    if (existingName) throw new LaneStoreError('lane_duplicate', 'A lane with this name already exists in this workspace.', 409);
    await db.insertInto('WorkspaceLane').values(row).execute();
    await this.audit(row.laneId, row.parentWorkspaceId, 'lane_created', 'Lane created.', { name: row.name, purpose: row.purpose });
    return this.getLane(row.parentWorkspaceId, row.laneId) as Promise<LaneReadModel>;
  }

  async listLanes(parentWorkspaceId: string): Promise<LaneReadModel[]> {
    const db = await this.getDb();
    const rows = await db.selectFrom('WorkspaceLane').selectAll().where('parentWorkspaceId', '=', parentWorkspaceId).orderBy('updatedAt', 'desc').execute();
    return Promise.all(rows.map((row) => this.mapLane(row)));
  }

  async getLane(parentWorkspaceId: string, laneId: string): Promise<LaneReadModel | null> {
    const row = await this.getLaneRow(laneId);
    if (!row) return null;
    if (row.parentWorkspaceId !== parentWorkspaceId) throw new LaneStoreError('lane_wrong_workspace', 'Lane belongs to a different parent workspace.', 404);
    return this.mapLane(row);
  }

  async getLaneById(laneId: string): Promise<LaneReadModel | null> {
    const row = await this.getLaneRow(laneId);
    return row ? this.mapLane(row) : null;
  }

  async updateLaneStatus(parentWorkspaceId: string, laneId: string, status: WorkspaceLaneStatus, options: { lastActiveRunId?: string | null } = {}): Promise<LaneReadModel> {
    if (!MUTABLE_STATUSES.includes(status)) throw new LaneStoreError('lane_invalid_status', `Lane status ${status} is not supported.`);
    const row = await this.requireMutableLane(parentWorkspaceId, laneId, { allowArchive: status === 'archived' });
    if (row.status === 'archived') throw new LaneStoreError('lane_archived', 'Archived lanes cannot be mutated.', 409);
    if (status === 'completed' || status === 'archived') {
      const active = await this.activeLease(row.laneId);
      if (active) throw new LaneStoreError('lane_capacity_conflict', 'Release active write capacity before completing or archiving this lane.', 409);
    }
    const now = this.now();
    await (await this.getDb()).updateTable('WorkspaceLane').set({
      status,
      updatedAt: now,
      archivedAt: status === 'archived' ? now : row.archivedAt,
      lastActiveRunId: clean(options.lastActiveRunId) ?? row.lastActiveRunId,
    }).where('laneId', '=', laneId).execute();
    await this.audit(laneId, parentWorkspaceId, status === 'archived' ? 'lane_archived' : 'lane_status_updated', `Lane marked ${status}.`, { status });
    return this.getLane(parentWorkspaceId, laneId) as Promise<LaneReadModel>;
  }

  async archiveLane(parentWorkspaceId: string, laneId: string): Promise<LaneReadModel> {
    return this.updateLaneStatus(parentWorkspaceId, laneId, 'archived');
  }

  async markLaneWorktreeStatus(
    parentWorkspaceId: string,
    laneId: string,
    worktreeStatus: WorkspaceLaneWorktreeStatus,
    summary: Record<string, unknown> | null = null,
  ): Promise<LaneReadModel> {
    const lane = await this.requireMutableLane(parentWorkspaceId, laneId);
    const now = this.now();
    await (await this.getDb()).updateTable('WorkspaceLane').set({
      worktreeStatus,
      worktreeSummaryJson: summary ? JSON.stringify(summary) : null,
      updatedAt: now,
    }).where('laneId', '=', lane.laneId).execute();
    await this.audit(
      lane.laneId,
      lane.parentWorkspaceId,
      'lane_worktree_status_updated',
      `Lane worktree marked ${worktreeStatus}.`,
      { worktreeStatus },
    );
    return this.getLane(parentWorkspaceId, laneId) as Promise<LaneReadModel>;
  }

  async explicitCleanup(
    parentWorkspaceId: string,
    laneId: string,
    input: { actorId?: string | null; reason: string },
  ): Promise<LaneReadModel> {
    const lane = await this.assertLaneParent(parentWorkspaceId, laneId);
    if (!FINAL_STATUSES.includes(lane.status))
      throw new LaneStoreError(
        'lane_invalid_status',
        'Only completed or archived lanes can be cleaned up in this slice.',
        409,
      );
    const active = await this.activeLease(laneId);
    if (active)
      throw new LaneStoreError(
        'lane_capacity_conflict',
        'Release active write capacity before cleaning up this lane.',
        409,
      );
    await this.audit(
      laneId,
      parentWorkspaceId,
      'lane_cleanup_requested',
      'Lane cleanup requested explicitly.',
      { reason: input.reason, cleanupMode: 'audit_only' },
      input.actorId ?? null,
    );
    return this.getLane(parentWorkspaceId, laneId) as Promise<LaneReadModel>;
  }

  async listAuditEvents(
    parentWorkspaceId: string,
    laneId: string,
    limit = 50,
  ): Promise<LaneAuditEventReadModel[]> {
    await this.assertLaneParent(parentWorkspaceId, laneId);
    const rows = await (await this.getDb())
      .selectFrom('WorkspaceLaneAuditEvent')
      .selectAll()
      .where('laneId', '=', laneId)
      .orderBy('createdAt', 'desc')
      .limit(Math.min(Math.max(limit, 1), 200))
      .execute();
    return rows.map((row) => ({
      auditId: row.auditId,
      laneId: row.laneId,
      parentWorkspaceId: row.parentWorkspaceId,
      eventType: row.eventType,
      actorId: row.actorId,
      message: row.message,
      data: parseRecord(row.dataJson),
      createdAt: row.createdAt,
    }));
  }

  async bindLane(input: BindLaneInput): Promise<LaneBindingReadModel> {
    const lane = await this.requireMutableLane(input.parentWorkspaceId, input.laneId);
    const db = await this.getDb();
    const existing = await db.selectFrom('WorkspaceLaneBinding').selectAll().where('bindingType', '=', input.bindingType).where('bindingKey', '=', input.bindingKey).executeTakeFirst();
    if (existing) {
      if (existing.laneId === input.laneId && existing.parentWorkspaceId === input.parentWorkspaceId) return mapBinding(existing);
      throw new LaneStoreError('lane_binding_conflict', 'This workflow or bead is already bound to another lane and cannot silently switch.', 409);
    }
    const now = this.now();
    const row = {
      bindingId: clean(input.bindingId) ?? randomUUID(),
      laneId: lane.laneId,
      parentWorkspaceId: lane.parentWorkspaceId,
      bindingType: input.bindingType,
      bindingKey: cleanRequired(input.bindingKey, 'binding key'),
      reason: clean(input.reason),
      accessMode: input.accessMode ?? 'read',
      roleBindingsJson: JSON.stringify(input.roleBindings ?? {}),
      createdAt: now,
      updatedAt: now,
    } satisfies Insertable<WorkspaceLaneBinding>;
    await db.insertInto('WorkspaceLaneBinding').values(row).execute();
    await db.updateTable('WorkspaceLane').set({ updatedAt: now, lastActiveRunId: input.bindingType === 'workflow_run' ? input.bindingKey : lane.lastActiveRunId }).where('laneId', '=', lane.laneId).execute();
    await this.audit(lane.laneId, lane.parentWorkspaceId, 'lane_bound', 'Lane binding recorded.', { bindingType: row.bindingType, bindingKey: row.bindingKey, accessMode: row.accessMode });
    return mapBinding(row);
  }

  async findOrCreateBindingForBead(input: { parentWorkspaceId: string; laneName: string; beadId: string; purpose: string; sourceBranch: string; accessMode?: WorkspaceLaneAccessMode; reason?: string }): Promise<LaneBindingReadModel> {
    const existingBinding = await this.getBinding('bead', input.beadId);
    if (existingBinding) return existingBinding;
    const existingLane = (await this.listLanes(input.parentWorkspaceId)).find((lane) => lane.name === input.laneName && lane.status !== 'archived');
    const lane = existingLane ?? await this.createLane({ parentWorkspaceId: input.parentWorkspaceId, name: input.laneName, purpose: input.purpose, sourceBranch: input.sourceBranch, status: 'planned', createdBy: { type: 'bead', beadId: input.beadId } });
    return this.bindLane({ parentWorkspaceId: input.parentWorkspaceId, laneId: lane.laneId, bindingType: 'bead', bindingKey: input.beadId, accessMode: input.accessMode ?? 'write', reason: input.reason ?? 'Milestone bead selected this lane.' });
  }

  async getBinding(bindingType: WorkspaceLaneBindingType, bindingKey: string): Promise<LaneBindingReadModel | null> {
    const row = await (await this.getDb()).selectFrom('WorkspaceLaneBinding').selectAll().where('bindingType', '=', bindingType).where('bindingKey', '=', bindingKey).executeTakeFirst();
    return row ? mapBinding(row) : null;
  }

  async acquireWriteToken(input: AcquireWriteTokenInput): Promise<LaneCapacityReadModel['write'] & { leaseId: string | null }> {
    const lane = await this.requireMutableLane(input.parentWorkspaceId, input.laneId);
    if (lane.worktreeStatus === 'dirty' || lane.worktreeStatus === 'unknown') throw new LaneStoreError('lane_write_blocked', `Lane worktree is ${lane.worktreeStatus}; inspect or clean it before write work starts.`, 409);
    const existing = await this.activeLease(input.laneId);
    if (existing) {
      if (isLeaseExpired(existing, this.now())) {
        await this.markLeaseStale(existing, 'Lease expired or owner lost; manual recovery required before new writes.');
        throw new LaneStoreError('lane_capacity_stale_or_orphan', 'Write capacity is stale or orphaned; recover the lease before starting new write work.', 409);
      }
      throw new LaneStoreError('lane_capacity_conflict', 'Lane already has an active write turn. Wait for release before starting another writer.', 409);
    }
    const stale = await (await this.getDb()).selectFrom('WorkspaceLaneCapacityLease').selectAll().where('laneId', '=', input.laneId).where('status', '=', 'stale').executeTakeFirst();
    if (stale) throw new LaneStoreError('lane_capacity_stale_or_orphan', 'Lane has stale write capacity that must be recovered before new work starts.', 409);
    const now = this.now();
    const row = {
      leaseId: clean(input.leaseId) ?? randomUUID(),
      laneId: lane.laneId,
      parentWorkspaceId: lane.parentWorkspaceId,
      mode: 'write' as const,
      ownerId: cleanRequired(input.ownerId, 'owner id'),
      status: 'active' as WorkspaceLaneCapacityLeaseStatus,
      acquiredAt: now,
      expiresAt: input.leaseDurationMs && input.leaseDurationMs > 0 ? now + input.leaseDurationMs : null,
      releasedAt: null,
      releaseReason: null,
      recoveryReason: null,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    } satisfies Insertable<WorkspaceLaneCapacityLease>;
    await (await this.getDb()).insertInto('WorkspaceLaneCapacityLease').values(row).execute();
    await this.audit(lane.laneId, lane.parentWorkspaceId, 'write_token_acquired', 'Write capacity acquired.', { leaseId: row.leaseId, ownerId: row.ownerId, expiresAt: row.expiresAt });
    return { status: 'held', activeLeaseId: row.leaseId, ownerId: row.ownerId, acquiredAt: row.acquiredAt, expiresAt: row.expiresAt, reason: 'Write capacity acquired.', recoveryPolicy: 'manual_release_or_owner_fenced_reclaim', leaseId: row.leaseId };
  }

  async releaseWriteToken(parentWorkspaceId: string, laneId: string, leaseId: string, reason = 'released'): Promise<LaneCapacityReadModel['write']> {
    await this.assertLaneParent(parentWorkspaceId, laneId);
    const db = await this.getDb();
    const lease = await db.selectFrom('WorkspaceLaneCapacityLease').selectAll().where('leaseId', '=', leaseId).executeTakeFirst();
    if (!lease || lease.laneId !== laneId) return this.capacityForLane(laneId);
    if (lease.status === 'released' || lease.status === 'reclaimed') return this.capacityForLane(laneId);
    const now = this.now();
    await db.updateTable('WorkspaceLaneCapacityLease').set({ status: 'released', releasedAt: now, releaseReason: reason, updatedAt: now }).where('leaseId', '=', leaseId).execute();
    await this.audit(laneId, parentWorkspaceId, 'write_token_released', 'Write capacity released.', { leaseId, reason });
    return this.capacityForLane(laneId);
  }

  async recoverStaleWriteToken(parentWorkspaceId: string, laneId: string, input: { leaseId?: string; actorId?: string | null; reason: string }): Promise<LaneCapacityReadModel['write']> {
    await this.assertLaneParent(parentWorkspaceId, laneId);
    const db = await this.getDb();
    let query = db.selectFrom('WorkspaceLaneCapacityLease').selectAll().where('laneId', '=', laneId).where('status', 'in', ['active', 'stale']);
    if (input.leaseId) query = query.where('leaseId', '=', input.leaseId);
    const leases = await query.execute();
    if (leases.length === 0) return this.capacityForLane(laneId);
    const now = this.now();
    for (const lease of leases) {
      await db.updateTable('WorkspaceLaneCapacityLease').set({ status: 'reclaimed', releasedAt: now, recoveryReason: cleanRequired(input.reason, 'recovery reason'), updatedAt: now }).where('leaseId', '=', lease.leaseId).execute();
      await this.audit(laneId, parentWorkspaceId, 'write_token_reclaimed', 'Stale write capacity reclaimed by policy.', { leaseId: lease.leaseId, actorId: input.actorId ?? null, reason: input.reason });
    }
    return this.capacityForLane(laneId);
  }

  async buildParentOverview(parentWorkspaceId: string): Promise<ParentLaneOverviewModel> {
    const lanes = await this.listLanes(parentWorkspaceId);
    const counts = { planned: 0, ready: 0, active: 0, paused: 0, blocked: 0, completed: 0, archived: 0 } satisfies Record<WorkspaceLaneStatus, number>;
    for (const lane of lanes) counts[lane.status] += 1;
    const activeWriteLanes = lanes.filter((lane) => lane.capacity.write.status === 'held').length;
    return {
      parentWorkspaceId,
      lanes,
      counts,
      activeWriteLanes,
      nextAction: lanes.some((lane) => lane.capacity.write.status === 'stale_or_orphan')
        ? 'Recover stale lane capacity before starting more write work.'
        : lanes.some((lane) => lane.status === 'blocked')
          ? 'Inspect blocked lane and choose resume, reassign, or archive.'
          : lanes.some((lane) => lane.status === 'active')
            ? 'Monitor active lanes or pause when handoff is needed.'
            : 'Create or select a lane when isolated milestone work is needed.',
    };
  }

  async getSelectedLaneWorkspaceContext(args: { parentWorkspaceId: string; laneId?: string | null; accessMode?: WorkspaceLaneAccessMode }): Promise<SelectedLaneWorkspaceContext> {
    if (!args.laneId) {
      return {
        workspaceId: args.parentWorkspaceId,
        parentWorkspaceId: args.parentWorkspaceId,
        laneId: null,
        laneLabel: 'Parent workspace',
        cwdMode: 'parent_workspace',
        allowsWrites: args.accessMode !== 'write',
        provenance: { laneId: null, laneLabel: 'Parent workspace', parentWorkspaceId: args.parentWorkspaceId, parentBreadcrumb: `Workspace ${args.parentWorkspaceId}`, cwdMode: 'parent_workspace', selectedWorkspaceId: args.parentWorkspaceId },
      };
    }
    const lane = await this.getLane(args.parentWorkspaceId, args.laneId);
    if (!lane) throw new LaneStoreError('lane_not_found', 'Lane was not found.', 404);
    return { workspaceId: lane.laneId, parentWorkspaceId: lane.parentWorkspaceId, laneId: lane.laneId, laneLabel: lane.label, cwdMode: 'sub_workspace_lane', allowsWrites: lane.status !== 'archived', provenance: lane.provenance };
  }

  private async assertParentExists(parentWorkspaceId: string): Promise<void> {
    const id = cleanRequired(parentWorkspaceId, 'parent workspace');
    if (this.parentWorkspaceExists && !(await this.parentWorkspaceExists(id))) throw new LaneStoreError('parent_workspace_not_found', 'Parent workspace was not found.', 404);
  }

  private async assertLaneParent(parentWorkspaceId: string, laneId: string): Promise<Selectable<WorkspaceLane>> {
    const row = await this.getLaneRow(laneId);
    if (!row) throw new LaneStoreError('lane_not_found', 'Lane was not found.', 404);
    if (row.parentWorkspaceId !== parentWorkspaceId) throw new LaneStoreError('lane_wrong_workspace', 'Lane belongs to a different parent workspace.', 404);
    return row;
  }

  private async requireMutableLane(parentWorkspaceId: string, laneId: string, options: { allowArchive?: boolean } = {}): Promise<Selectable<WorkspaceLane>> {
    const row = await this.assertLaneParent(parentWorkspaceId, laneId);
    if (row.status === 'archived' && !options.allowArchive) throw new LaneStoreError('lane_archived', 'Archived lanes cannot be mutated.', 409);
    return row;
  }

  private async getLaneRow(laneId: string): Promise<Selectable<WorkspaceLane> | undefined> {
    return (await this.getDb()).selectFrom('WorkspaceLane').selectAll().where('laneId', '=', laneId).executeTakeFirst();
  }

  private async mapLane(row: Selectable<WorkspaceLane>): Promise<LaneReadModel> {
    const [bindings, capacity] = await Promise.all([this.bindingsForLane(row.laneId), this.capacityForLane(row.laneId)]);
    const boundRunIds = bindings.filter((binding) => binding.bindingType === 'workflow_run' || binding.bindingType === 'workflow_instance').map((binding) => binding.bindingKey);
    const boundBeadIds = bindings.filter((binding) => binding.bindingType === 'bead' || binding.bindingType === 'milestone').map((binding) => binding.bindingKey);
    const label = row.name;
    return {
      laneId: row.laneId,
      parentWorkspaceId: row.parentWorkspaceId,
      isSubWorkspace: true,
      name: row.name,
      purpose: row.purpose,
      label,
      breadcrumb: `Workspace ${row.parentWorkspaceId} → ${label}`,
      status: row.status,
      sourceBranch: row.sourceBranch,
      workingBranch: row.workingBranch,
      worktree: { status: row.worktreeStatus, summary: row.worktreeSummaryJson ? parseRecord(row.worktreeSummaryJson) : null, display: worktreeDisplay(row.worktreeStatus) },
      capacity: { write: capacity },
      boundRunIds,
      boundBeadIds,
      bindings,
      provenance: { laneId: row.laneId, laneLabel: label, parentWorkspaceId: row.parentWorkspaceId, parentBreadcrumb: `Workspace ${row.parentWorkspaceId}`, cwdMode: 'sub_workspace_lane', selectedWorkspaceId: row.laneId },
      nextAction: nextAction(row, capacity),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
      lastActiveRunId: row.lastActiveRunId,
    };
  }

  private async bindingsForLane(laneId: string): Promise<LaneBindingReadModel[]> {
    const rows = await (await this.getDb()).selectFrom('WorkspaceLaneBinding').selectAll().where('laneId', '=', laneId).orderBy('updatedAt', 'desc').execute();
    return rows.map(mapBinding);
  }

  private async capacityForLane(laneId: string): Promise<LaneCapacityReadModel['write']> {
    const active = await this.activeLease(laneId);
    if (!active) {
      const stale = await (await this.getDb()).selectFrom('WorkspaceLaneCapacityLease').selectAll().where('laneId', '=', laneId).where('status', '=', 'stale').executeTakeFirst();
      if (stale) return { status: 'stale_or_orphan', activeLeaseId: stale.leaseId, ownerId: stale.ownerId, acquiredAt: stale.acquiredAt, expiresAt: stale.expiresAt, reason: 'Stale or orphaned write capacity requires recovery before new writes.', recoveryPolicy: 'manual_release_or_owner_fenced_reclaim' };
      return { status: 'available', activeLeaseId: null, ownerId: null, acquiredAt: null, expiresAt: null, reason: null, recoveryPolicy: 'manual_release_or_owner_fenced_reclaim' };
    }
    if (isLeaseExpired(active, this.now())) return { status: 'stale_or_orphan', activeLeaseId: active.leaseId, ownerId: active.ownerId, acquiredAt: active.acquiredAt, expiresAt: active.expiresAt, reason: 'Write capacity lease is expired; recover it before starting another writer.', recoveryPolicy: 'manual_release_or_owner_fenced_reclaim' };
    return { status: 'held', activeLeaseId: active.leaseId, ownerId: active.ownerId, acquiredAt: active.acquiredAt, expiresAt: active.expiresAt, reason: 'A write turn is active in this lane.', recoveryPolicy: 'manual_release_or_owner_fenced_reclaim' };
  }

  private async activeLease(laneId: string): Promise<Selectable<WorkspaceLaneCapacityLease> | undefined> {
    return (await this.getDb()).selectFrom('WorkspaceLaneCapacityLease').selectAll().where('laneId', '=', laneId).where('mode', '=', 'write').where('status', '=', 'active').orderBy('acquiredAt', 'asc').executeTakeFirst();
  }

  private async markLeaseStale(lease: Selectable<WorkspaceLaneCapacityLease>, reason: string): Promise<void> {
    const now = this.now();
    await (await this.getDb()).updateTable('WorkspaceLaneCapacityLease').set({ status: 'stale', recoveryReason: reason, updatedAt: now }).where('leaseId', '=', lease.leaseId).execute();
    await this.audit(lease.laneId, lease.parentWorkspaceId, 'write_token_marked_stale', 'Write capacity marked stale.', { leaseId: lease.leaseId, reason });
  }

  private async audit(laneId: string, parentWorkspaceId: string, eventType: string, message: string, data: Record<string, unknown>, actorId?: string | null): Promise<void> {
    await (await this.getDb()).insertInto('WorkspaceLaneAuditEvent').values({ auditId: randomUUID(), laneId, parentWorkspaceId, eventType, actorId: actorId ?? null, message, dataJson: JSON.stringify(data), createdAt: this.now() }).execute();
  }

  private async getDb(): Promise<Kysely<DB>> {
    return this.getDbHandle();
  }
}

function mapBinding(row: Selectable<WorkspaceLaneBinding>): LaneBindingReadModel {
  return { bindingId: row.bindingId, laneId: row.laneId, parentWorkspaceId: row.parentWorkspaceId, bindingType: row.bindingType, bindingKey: row.bindingKey, reason: row.reason, accessMode: row.accessMode, roleBindings: parseRecord(row.roleBindingsJson), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function isLeaseExpired(lease: Selectable<WorkspaceLaneCapacityLease>, now: number): boolean {
  return lease.expiresAt != null && lease.expiresAt <= now;
}

function nextAction(row: Selectable<WorkspaceLane>, capacity: LaneCapacityReadModel['write']): string {
  if (row.status === 'archived') return 'Archived for audit; reopen is not allowed in this foundation slice.';
  if (capacity.status === 'stale_or_orphan') return 'Recover stale write capacity before starting new work.';
  if (capacity.status === 'held') return 'Wait for active write turn to release capacity.';
  if (row.worktreeStatus === 'dirty') return 'Inspect or clean dirty lane worktree before write work.';
  if (row.worktreeStatus === 'unknown') return 'Refresh lane worktree status before write work.';
  if (row.status === 'blocked') return 'Inspect blocked reason and choose resume, reassign, or archive.';
  if (row.status === 'paused') return 'Resume when the workflow operator is ready.';
  if (FINAL_STATUSES.includes(row.status)) return 'Review handoff summary; archive when no longer needed.';
  return 'Ready for lane-backed workflow or bead binding.';
}

function worktreeDisplay(status: WorkspaceLaneWorktreeStatus): string {
  switch (status) {
    case 'pending': return 'Worktree pending';
    case 'clean': return 'Worktree clean';
    case 'dirty': return 'Needs attention: dirty worktree';
    case 'unknown': return 'Needs attention: worktree status unknown';
    default: return String(status);
  }
}

function parseRecord(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function clean(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

function cleanRequired(value: string | null | undefined, label: string): string {
  const trimmed = clean(value);
  if (!trimmed) throw new LaneStoreError('lane_invalid_status', `${label} is required.`);
  return trimmed;
}
