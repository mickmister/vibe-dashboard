import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { DB, WorkflowWorkArea, WorkflowWorkAreaRepository, WorkflowWorkAreaStatus } from '../../../../store/kysely_types';
import { sanitizeGasCityProviderText } from './gasCityWorkflowProvider';

const execFile = promisify(execFileCallback);
const CONSUMING_STATUSES: WorkflowWorkAreaStatus[] = ['reserved', 'provisioning', 'ready', 'blocked', 'retained'];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const DEFAULT_RESERVATION_PER_REPOSITORY = 2 * 1024 * 1024 * 1024;
const DEFAULT_MINIMUM_RESERVATION = 256 * 1024 * 1024;

export type WorkAreaOperationKind = 'preflight' | 'create_or_reuse' | 'reconcile';
export type WorkAreaResultStatus = 'ready' | 'blocked' | 'retained';

export interface RegisteredWorkAreaRepository { repoKey: string; repositoryRoot: string; sourceRevision: string }
export interface RegisteredWorkAreaWorkspace { workspaceId: string; workspaceRoot: string; repositories: RegisteredWorkAreaRepository[] }
export interface WorkflowWorkAreaWorkspaceRegistry { getWorkspace(workspaceId: string): Promise<RegisteredWorkAreaWorkspace | null> }
export interface WorkflowWorkAreaAuthorizer {
  authorize(input: { workspaceId: string; lineageKey: string; ownerRunId: string; actorId: string; roleId: string; mode: 'read' | 'write' }): Promise<boolean>;
}

export interface WorktreeSourceIdentity {
  canonicalRepositoryRoot: string;
  commonDirIdentity: string;
  sourceRevision: string;
}
export interface WorktreeInspection {
  exists: boolean; valid: boolean; dirty: boolean; active: boolean; uniqueWork: boolean;
  sourceRevision?: string; ownershipIdentity?: string;
}
export interface WorkflowWorktreeDriver {
  resolveSource(input: { repositoryRoot: string; sourceRevision: string }): Promise<WorktreeSourceIdentity>;
  inspect(input: { source: WorktreeSourceIdentity; worktreeRoot: string }): Promise<WorktreeInspection>;
  create(input: { source: WorktreeSourceIdentity; worktreeRoot: string }): Promise<void>;
}

export interface WorkAreaMutationLock {
  release(): Promise<void>;
}
export interface WorkAreaMutationLockManager {
  initialize(): Promise<{ canonicalLockRoot: string; hostIdentityDigest: string }>;
  acquire(input: { sourceIdentity: string; targetIdentity: string; holderId: string; waitMs: number }): Promise<WorkAreaMutationLock>;
}

interface MutationLockOwner { holderId: string; pid: number; processIdentity: string; createdAt: number }
type ProcessIdentityState = 'same' | 'different' | 'unknown';

/**
 * Cross-process mutation exclusion. The claim is an atomic hard link to a
 * fully-written owner record, so a crash cannot leave a claim with no owner.
 * Stale claims are recovered only after the recorded OS process identity is
 * proven absent/different; age alone never authorizes takeover. The server
 * state filesystem must support atomic hard links. There is deliberately no
 * weaker fallback because it could permit concurrent Git registry mutation.
 */
export class FilesystemWorkAreaMutationLockManager implements WorkAreaMutationLockManager {
  private readonly serverStateRoot: string;
  private initialized: Promise<{ canonicalLockRoot: string; hostIdentityDigest: string }> | null = null;
  constructor(private readonly options: {
    serverStateRoot?: string;
    processIdentity?: (pid: number, expected: string) => Promise<ProcessIdentityState>;
    currentProcessIdentity?: () => Promise<string>;
    now?: () => number;
    linkClaim?: typeof link;
    syncDirectory?: (path: string) => Promise<void>;
    forensicRetentionLimit?: number;
    runtimeHostIdentity?: () => Promise<string>;
  } = {}) {
    if (!options.serverStateRoot) throw new WorkflowWorkAreaError('unsafe_layout', 'A server lock storage capability is required.');
    this.serverStateRoot = options.serverStateRoot;
  }

  initialize() { return this.initialized ??= validateGlobalLockCapability(this.serverStateRoot, this.options.linkClaim ?? link,
    this.options.syncDirectory ?? fsyncDirectory, this.options.currentProcessIdentity ?? currentProcessIdentity,
    this.options.runtimeHostIdentity ?? deriveRuntimeHostIdentity); }

  async acquire(input: { sourceIdentity: string; targetIdentity: string; holderId: string; waitMs: number }): Promise<WorkAreaMutationLock> {
    const lockRoot = (await this.initialize()).canonicalLockRoot;
    await cleanupLockMetadata(lockRoot, this.options.forensicRetentionLimit ?? 32, this.options.processIdentity ?? inspectProcessIdentity, this.options.syncDirectory ?? fsyncDirectory);
    // Serialize all worktree-registry mutations for the same source repository;
    // target identity remains in the caller contract for deterministic auditing.
    const key = stableDigest({ source: input.sourceIdentity });
    const claimPath = join(lockRoot, `${key}.lock`);
    const deadline = (this.options.now ?? Date.now)() + input.waitMs;
    const owner: MutationLockOwner = { holderId: input.holderId, pid: process.pid,
      processIdentity: await (this.options.currentProcessIdentity ?? currentProcessIdentity)(), createdAt: (this.options.now ?? Date.now)() };
    const ownerPath = join(lockRoot, `.${key}.${input.holderId}.owner`);
    const file = await open(ownerPath, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(owner)); await file.sync(); } finally { await file.close(); }
    await (this.options.syncDirectory ?? fsyncDirectory)(lockRoot);
    try {
      while ((this.options.now ?? Date.now)() <= deadline) {
        try {
          await (this.options.linkClaim ?? link)(ownerPath, claimPath);
          await (this.options.syncDirectory ?? fsyncDirectory)(lockRoot);
          await unlink(ownerPath);
          await (this.options.syncDirectory ?? fsyncDirectory)(lockRoot);
          return { release: async () => {
            const current = await readLockOwner(claimPath);
            if (current?.holderId === owner.holderId && current.processIdentity === owner.processIdentity) {
              await unlink(claimPath).catch(ignoreMissing);
              await (this.options.syncDirectory ?? fsyncDirectory)(lockRoot);
            }
          } };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const existing = await readLockOwner(claimPath);
          if (!existing) throw new WorkflowWorkAreaError('operation_busy', 'Task work filesystem ownership could not be verified.');
          const state = await (this.options.processIdentity ?? inspectProcessIdentity)(existing.pid, existing.processIdentity);
          if (state === 'different') {
            try { await rename(claimPath, join(lockRoot, `.${key}.${randomUUID()}.stale`)); await (this.options.syncDirectory ?? fsyncDirectory)(lockRoot); continue; }
            catch (renameError) { if ((renameError as NodeJS.ErrnoException).code !== 'ENOENT') throw renameError; }
          }
          // Unknown identity is never stealable (notably macOS same-second PID
          // ambiguity), but the current holder may release during this wait.
          await delay(20);
        }
      }
      throw new WorkflowWorkAreaError('operation_busy', 'Task work filesystem preparation is still active.');
    } catch (error) {
      const removed = await unlink(ownerPath).then(() => true, (unlinkError) => { ignoreMissing(unlinkError); return false; });
      if (removed) await (this.options.syncDirectory ?? fsyncDirectory)(lockRoot);
      throw error;
    }
  }
}

export interface WorkflowWorkAreaRequest {
  workspaceId: string; lineageKey: string; ownerRunId: string; operationKey: string;
  actorId: string; roleId: string; mode: 'read' | 'write'; kind: WorkAreaOperationKind;
  repoKeys?: string[];
}
export interface WorkflowWorkAreaReadModel {
  workAreaId: string; workspaceId: string; lineageKey: string; ownerRunId: string; generation: number;
  status: WorkAreaResultStatus;
  repositories: Array<{ repoKey: string; status: 'ready' | 'blocked' | 'retained'; dirty: boolean; active: boolean; uniqueWork: boolean; message: string }>;
  capacity: { estimatedReservedBytes: number; accounting: 'estimated_reservation' };
  nextAction: string;
}
export class WorkflowWorkAreaError extends Error {
  constructor(public readonly code: 'invalid_request' | 'not_authorized' | 'not_found' | 'conflict' | 'quota_exceeded' | 'unsafe_layout' | 'operation_busy', message: string) {
    super(message); this.name = 'WorkflowWorkAreaError';
  }
}
class WorkAreaLeaseLostError extends WorkflowWorkAreaError {
  constructor() { super('conflict', 'Task work preparation ownership changed during setup.'); }
}

interface ReservationInput {
  workspaceId: string; lineageKey: string; ownerRunId: string; layoutDigest: string; operationKey: string;
  requestDigest: string; actorId: string; kind: WorkAreaOperationKind; reserveBytes: number; countLimit: number; byteLimit: number;
}
interface LeaseClaimInput {
  leaseKey: string; workAreaId: string; repoKey: string; operationId: string; requestDigest: string; holderId: string; ttlMs: number;
}

export class DbWorkflowWorkAreaRegistry {
  private readonly now: () => number;
  constructor(private readonly options: { db: Kysely<DB>; now?: () => number }) { this.now = options.now ?? (() => Date.now()); }
  private get db(): Kysely<DB> { return this.options.db; }

  async configureRegistryKind(input: { kind: 'production' | 'development'; registryId: string }): Promise<void> {
    const registryId = requiredId(input.registryId, 'registry');
    await retrySqliteBusy(() => this.db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('WorkflowWorkAreaRegistryIdentity').selectAll().where('singletonKey', '=', 'work-area-registry').executeTakeFirst();
      if (existing) {
        if (existing.kind !== input.kind || existing.registryId !== registryId) throw conflict('Task work registry identity does not match this deployment.');
        return;
      }
      const [areas, domains] = await Promise.all([
        trx.selectFrom('WorkflowWorkArea').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow(),
        trx.selectFrom('WorkflowWorkAreaLockDomain').select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirstOrThrow(),
      ]);
      if (Number(areas.count) !== 0 || Number(domains.count) !== 0) throw conflict('Task work registry must be designated before use.');
      await trx.insertInto('WorkflowWorkAreaRegistryIdentity').values({ singletonKey: 'work-area-registry', registryId,
        kind: input.kind, createdAt: this.now(), updatedAt: this.now() }).execute();
    }));
  }

  async assertRegistryKind(kind: 'production' | 'development'): Promise<void> {
    const identity = await this.db.selectFrom('WorkflowWorkAreaRegistryIdentity').selectAll().where('singletonKey', '=', 'work-area-registry').executeTakeFirst();
    if (!identity || identity.kind !== kind) throw conflict('Task work registry is not designated for this runtime.');
  }

  async adoptLegacyProductionRegistry(input: { adoptionKey: string; requestDigest: string; registryId: string; actorId: string;
    lockDomainId: string; legacyDomainDigest: string }): Promise<void> {
    await retrySqliteBusy(() => this.db.transaction().execute(async (trx) => {
      const previous = await trx.selectFrom('WorkflowWorkAreaRegistryAdoptionAudit').selectAll().where('adoptionKey', '=', input.adoptionKey).executeTakeFirst();
      if (previous) {
        if (previous.requestDigest !== input.requestDigest || previous.actorId !== input.actorId) throw conflict('Registry adoption request conflicts with an earlier operation.');
        return;
      }
      if (await trx.selectFrom('WorkflowWorkAreaRegistryIdentity').select('singletonKey').executeTakeFirst()) throw conflict('Task work registry is already designated.');
      const domains = await trx.selectFrom('WorkflowWorkAreaLockDomain').selectAll().execute();
      if (domains.length !== 1 || domains[0]!.singletonKey !== 'work-area-provider' || domains[0]!.lockDomainId !== input.lockDomainId
        || domains[0]!.domainDigest !== input.legacyDomainDigest || domains[0]!.deploymentMode !== null || domains[0]!.hostIdentityDigest !== null) {
        throw conflict('Legacy task work lock identity does not match the trusted migration request.');
      }
      await assertCompatibleLegacyRegistry(trx);
      const now = this.now();
      await trx.insertInto('WorkflowWorkAreaRegistryIdentity').values({ singletonKey: 'work-area-registry', registryId: input.registryId,
        kind: 'production', createdAt: now, updatedAt: now }).execute();
      await trx.insertInto('WorkflowWorkAreaRegistryAdoptionAudit').values({ adoptionKey: input.adoptionKey, requestDigest: input.requestDigest,
        registryId: input.registryId, actorId: input.actorId, eventType: 'legacy_production_registry_adopted', createdAt: now }).execute();
    }));
  }

  async assertDeploymentLockDomain(input: { lockDomainId: string; domainDigest: string; legacyDomainDigest: string; deploymentMode: string; hostIdentityDigest: string }): Promise<void> {
    await retrySqliteBusy(() => this.db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('WorkflowWorkAreaLockDomain').selectAll().where('singletonKey', '=', 'work-area-provider').executeTakeFirst();
      if (existing) {
        if (existing.deploymentMode === null && existing.hostIdentityDigest === null && existing.lockDomainId === input.lockDomainId && existing.domainDigest === input.legacyDomainDigest) {
          const adopted = await trx.updateTable('WorkflowWorkAreaLockDomain').set({ domainDigest: input.domainDigest, deploymentMode: input.deploymentMode,
            hostIdentityDigest: input.hostIdentityDigest, updatedAt: this.now() }).where('singletonKey', '=', 'work-area-provider')
            .where('deploymentMode', 'is', null).where('hostIdentityDigest', 'is', null).executeTakeFirst();
          if (Number(adopted.numUpdatedRows) === 1) return;
        }
        if (existing.lockDomainId !== input.lockDomainId || existing.domainDigest !== input.domainDigest || existing.deploymentMode !== input.deploymentMode
          || existing.hostIdentityDigest !== input.hostIdentityDigest) throw conflict('Task work lock deployment configuration does not match this registry.');
        return;
      }
      try {
        await trx.insertInto('WorkflowWorkAreaLockDomain').values({ singletonKey: 'work-area-provider', lockDomainId: input.lockDomainId,
          domainDigest: input.domainDigest, deploymentMode: input.deploymentMode, hostIdentityDigest: input.hostIdentityDigest,
          createdAt: this.now(), updatedAt: this.now() }).execute();
      } catch (error) {
        const raced = await trx.selectFrom('WorkflowWorkAreaLockDomain').selectAll().where('singletonKey', '=', 'work-area-provider').executeTakeFirst();
        if (!raced || raced.lockDomainId !== input.lockDomainId || raced.domainDigest !== input.domainDigest
          || raced.deploymentMode !== input.deploymentMode || raced.hostIdentityDigest !== input.hostIdentityDigest) throw error;
      }
    }));
  }

  async reserve(input: ReservationInput): Promise<{ area: Selectable<WorkflowWorkArea>; operationId: string; reused: boolean }> {
    return retrySqliteBusy(() => this.db.transaction().execute(async (trx) => {
      const previous = await trx.selectFrom('WorkflowWorkAreaOperation').selectAll().where('operationKey', '=', input.operationKey).executeTakeFirst();
      if (previous) {
        if (previous.requestDigest !== input.requestDigest) throw conflict('This operation key belongs to different work.');
        const area = await requireArea(trx, previous.workAreaId);
        assertAreaIdentity(area, input);
        return { area, operationId: previous.operationId, reused: true };
      }
      const existing = await trx.selectFrom('WorkflowWorkArea').selectAll().where('workspaceId', '=', input.workspaceId).where('lineageKey', '=', input.lineageKey).executeTakeFirst();
      if (existing) assertAreaIdentity(existing, input);
      const area = existing ?? await this.insertWithinQuota(trx, input);
      const operationId = stableOpaqueId('waop', input.operationKey);
      const now = this.now();
      try {
        await trx.insertInto('WorkflowWorkAreaOperation').values({ operationId, operationKey: input.operationKey, requestDigest: input.requestDigest,
          workAreaId: area.workAreaId, actorId: input.actorId, kind: input.kind, status: 'preparing', message: 'Preparing isolated task work.', createdAt: now, updatedAt: now }).execute();
      } catch {
        const raced = await trx.selectFrom('WorkflowWorkAreaOperation').selectAll().where('operationKey', '=', input.operationKey).executeTakeFirst();
        if (!raced || raced.requestDigest !== input.requestDigest) throw conflict('This operation key belongs to different work.');
        const racedArea = await requireArea(trx, raced.workAreaId);
        assertAreaIdentity(racedArea, input);
        return { area: racedArea, operationId: raced.operationId, reused: true };
      }
      await this.audit(trx, area, operationId, input.actorId, existing ? 'operation_reused_area' : 'area_reserved', existing ? 'Existing task work area selected.' : 'Task work area capacity reserved.');
      return { area, operationId, reused: Boolean(existing) };
    }));
  }

  private async insertWithinQuota(trx: Transaction<DB>, input: ReservationInput): Promise<Selectable<WorkflowWorkArea>> {
    const now = this.now();
    const id = randomUUID();
    try {
      const inserted = await sql<Selectable<WorkflowWorkArea>>`
        INSERT INTO WorkflowWorkArea (workAreaId, workspaceId, lineageKey, ownerRunId, layoutDigest, status, generation, reservedBytes, retainReason, createdAt, updatedAt)
        SELECT ${id}, ${input.workspaceId}, ${input.lineageKey}, ${input.ownerRunId}, ${input.layoutDigest}, 'reserved', 1, ${input.reserveBytes}, NULL, ${now}, ${now}
        WHERE (SELECT COUNT(*) FROM WorkflowWorkArea WHERE workspaceId = ${input.workspaceId} AND status IN (${sql.join(CONSUMING_STATUSES)})) < ${input.countLimit}
          AND (SELECT COALESCE(SUM(reservedBytes), 0) FROM WorkflowWorkArea WHERE workspaceId = ${input.workspaceId} AND status IN (${sql.join(CONSUMING_STATUSES)})) + ${input.reserveBytes} <= ${input.byteLimit}
        RETURNING *`.execute(trx);
      if (!inserted.rows[0]) throw new WorkflowWorkAreaError('quota_exceeded', 'Temporary work capacity is full for this workspace.');
      return inserted.rows[0];
    } catch (error) {
      const raced = await trx.selectFrom('WorkflowWorkArea').selectAll().where('workspaceId', '=', input.workspaceId).where('lineageKey', '=', input.lineageKey).executeTakeFirst();
      if (raced) { assertAreaIdentity(raced, input); return raced; }
      throw error;
    }
  }

  async claimLease(input: LeaseClaimInput): Promise<{ acquired: boolean; fence: number; expiresAt: number }> {
    return retrySqliteBusy(() => this.db.transaction().execute(async (trx) => {
      const now = this.now();
      const current = await trx.selectFrom('WorkflowWorkAreaOperationLease').selectAll().where('leaseKey', '=', input.leaseKey).executeTakeFirst();
      if (!current) {
        await trx.insertInto('WorkflowWorkAreaOperationLease').values({ leaseKey: input.leaseKey, workAreaId: input.workAreaId,
          repoKey: input.repoKey, operationId: input.operationId, requestDigest: input.requestDigest, holderId: input.holderId,
          fence: 1, status: 'active', expiresAt: now + input.ttlMs, heartbeatAt: now, createdAt: now, updatedAt: now }).execute();
        return { acquired: true, fence: 1, expiresAt: now + input.ttlMs };
      }
      if (current.status === 'active' && current.expiresAt > now && current.holderId !== input.holderId) return { acquired: false, fence: current.fence, expiresAt: current.expiresAt };
      if (current.holderId === input.holderId && current.requestDigest !== input.requestDigest) throw conflict('The active work-area lease belongs to different work.');
      const fence = current.fence + (current.holderId === input.holderId && current.status === 'active' ? 0 : 1);
      const updated = await trx.updateTable('WorkflowWorkAreaOperationLease').set({ workAreaId: input.workAreaId, repoKey: input.repoKey,
        operationId: input.operationId, requestDigest: input.requestDigest, holderId: input.holderId, fence, status: 'active',
        expiresAt: now + input.ttlMs, heartbeatAt: now, updatedAt: now }).where('leaseKey', '=', input.leaseKey).where('fence', '=', current.fence).executeTakeFirst();
      return { acquired: Number(updated.numUpdatedRows) === 1, fence, expiresAt: now + input.ttlMs };
    }));
  }

  async heartbeatLease(leaseKey: string, holderId: string, fence: number, ttlMs: number): Promise<boolean> {
    const now = this.now();
    const result = await this.db.updateTable('WorkflowWorkAreaOperationLease').set({ expiresAt: now + ttlMs, heartbeatAt: now, updatedAt: now })
      .where('leaseKey', '=', leaseKey).where('holderId', '=', holderId).where('fence', '=', fence).where('status', '=', 'active').where('expiresAt', '>', now).executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async releaseLease(leaseKey: string, holderId: string, fence: number): Promise<boolean> {
    const result = await this.db.updateTable('WorkflowWorkAreaOperationLease').set({ status: 'released', updatedAt: this.now() })
      .where('leaseKey', '=', leaseKey).where('holderId', '=', holderId).where('fence', '=', fence).where('status', '=', 'active').executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async upsertRepository(input: { workAreaId: string; repoKey: string; sourceRevision: string; sourceIdentity: string; status: WorkflowWorkAreaRepository['status']; dirty?: boolean; active?: boolean; uniqueWork?: boolean; retainReason?: string | null }): Promise<void> {
    const area = await this.get(input.workAreaId); if (!area) throw new WorkflowWorkAreaError('not_found', 'Task work area was not found.');
    const existing = await this.db.selectFrom('WorkflowWorkAreaRepository').select(['sourceRevision', 'sourceIdentity']).where('workAreaId', '=', input.workAreaId).where('repoKey', '=', input.repoKey).executeTakeFirst();
    if (existing && (existing.sourceRevision !== input.sourceRevision || (existing.sourceIdentity && existing.sourceIdentity !== input.sourceIdentity))) throw conflict('The confirmed repository identity changed for this task lineage.');
    const now = this.now();
    await this.db.insertInto('WorkflowWorkAreaRepository').values({ workAreaId: input.workAreaId, repoKey: input.repoKey, sourceRevision: input.sourceRevision,
      sourceIdentity: input.sourceIdentity, status: input.status, generation: area.generation, dirty: input.dirty ? 1 : 0, active: input.active ? 1 : 0,
      uniqueWork: input.uniqueWork ? 1 : 0, retainReason: input.retainReason ?? null, createdAt: now, updatedAt: now })
      .onConflict((c) => c.columns(['workAreaId', 'repoKey']).doUpdateSet({ sourceIdentity: input.sourceIdentity, status: input.status,
        generation: area.generation, dirty: input.dirty ? 1 : 0, active: input.active ? 1 : 0, uniqueWork: input.uniqueWork ? 1 : 0,
        retainReason: input.retainReason ?? null, updatedAt: now })).execute();
  }

  async finish(workAreaId: string, operationId: string, status: 'ready' | 'blocked' | 'retained', actorId: string, message: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => { const now = this.now(); const area = await requireArea(trx, workAreaId);
      await trx.updateTable('WorkflowWorkArea').set({ status, retainReason: status === 'ready' ? null : message, updatedAt: now }).where('workAreaId', '=', workAreaId).execute();
      await trx.updateTable('WorkflowWorkAreaOperation').set({ status: status === 'ready' ? 'completed' : 'blocked', message, updatedAt: now }).where('operationId', '=', operationId).where('workAreaId', '=', workAreaId).execute();
      await this.audit(trx, area, operationId, actorId, `area_${status}`, message); });
  }
  async blockOperation(operationId: string, message: string): Promise<void> {
    await this.db.updateTable('WorkflowWorkAreaOperation').set({ status: 'blocked', message, updatedAt: this.now() }).where('operationId', '=', operationId).execute();
  }
  get(id: string) { return this.db.selectFrom('WorkflowWorkArea').selectAll().where('workAreaId', '=', id).executeTakeFirst(); }
  listRepositories(id: string) { return this.db.selectFrom('WorkflowWorkAreaRepository').selectAll().where('workAreaId', '=', id).orderBy('repoKey').execute(); }
  private async audit(trx: Transaction<DB>, area: Selectable<WorkflowWorkArea>, operationId: string, actorId: string, eventType: string, message: string) {
    await trx.insertInto('WorkflowWorkAreaAuditEvent').values({ auditId: randomUUID(), workAreaId: area.workAreaId, workspaceId: area.workspaceId, operationId, actorId, eventType, message, createdAt: this.now() }).execute();
  }
}

interface PreparedRepository extends RegisteredWorkAreaRepository { source: WorktreeSourceIdentity }
export interface ProductionWorkflowWorkAreaProviderOptions {
  registry: DbWorkflowWorkAreaRegistry; workspaceRegistry: WorkflowWorkAreaWorkspaceRegistry; authorizer: WorkflowWorkAreaAuthorizer;
  worktreeDriver?: WorkflowWorktreeDriver; countLimit?: number; byteLimit?: number;
  estimateReservationBytes?: (input: { workspaceId: string; repositoryCount: number; mode: 'read' | 'write' }) => number;
  minimumReservationBytes?: number; leaseTtlMs?: number; leaseWaitMs?: number; now?: () => number;
  mutationLockManager?: WorkAreaMutationLockManager;
  runtimeClassification: 'production' | 'development' | 'test';
  /** Trusted deployment capability; never populated from a workflow request. */
  deployment: WorkAreaDeploymentCapability;
}

export type WorkAreaDeploymentCapability =
  | { mode: 'production_single_host'; serverStateRoot: string; lockDomainId: string; hostId: string }
  | { mode: 'development_temporary'; unsafeDevelopmentOptIn: true; registryNamespace: string; serverStateRoot?: string };

/** Trusted server-maintenance operation. It is intentionally not registered as a route or workflow action. */
export async function adoptLegacyProductionWorkAreaRegistry(input: { registry: DbWorkflowWorkAreaRegistry; mutationLockManager: WorkAreaMutationLockManager;
  runtimeClassification: 'production' | 'development' | 'test'; deployment: WorkAreaDeploymentCapability; registryId: string; adoptionKey: string; actorId: string }) {
  const deployment = normalizeDeploymentCapability(input.deployment, input.runtimeClassification);
  if (deployment.mode !== 'production_single_host') throw new WorkflowWorkAreaError('not_authorized', 'Only a production registry can be adopted.');
  const registryId = requiredId(input.registryId, 'registry'); const adoptionKey = requiredId(input.adoptionKey, 'adoption operation');
  const actorId = requiredId(input.actorId, 'maintenance actor');
  const { canonicalLockRoot, hostIdentityDigest } = await input.mutationLockManager.initialize();
  const digests = deploymentDomainDigests(deployment, canonicalLockRoot, hostIdentityDigest);
  const requestDigest = stableDigest({ registryId, adoptionKey, actorId, lockDomainId: deployment.lockDomainId, ...digests });
  await input.registry.adoptLegacyProductionRegistry({ adoptionKey, requestDigest, registryId, actorId,
    lockDomainId: deployment.lockDomainId, legacyDomainDigest: digests.legacyDomainDigest });
}

export class ProductionWorkflowWorkAreaProvider {
  private readonly driver: WorkflowWorktreeDriver; private readonly countLimit: number; private readonly byteLimit: number;
  private readonly minimumReservation: number; private readonly leaseTtl: number; private readonly leaseWait: number; private readonly now: () => number;
  private readonly mutationLocks: WorkAreaMutationLockManager;
  private readonly deployment: ReturnType<typeof normalizeDeploymentCapability>;
  private deploymentReady: Promise<void> | null = null;
  constructor(private readonly options: ProductionWorkflowWorkAreaProviderOptions) {
    this.driver = options.worktreeDriver ?? new GitWorkflowWorktreeDriver(); this.countLimit = options.countLimit ?? 8;
    this.byteLimit = options.byteLimit ?? 20 * 1024 * 1024 * 1024; this.minimumReservation = Math.max(1, options.minimumReservationBytes ?? DEFAULT_MINIMUM_RESERVATION);
    this.leaseTtl = options.leaseTtlMs ?? 30_000; this.leaseWait = options.leaseWaitMs ?? 35_000; this.now = options.now ?? (() => Date.now());
    this.deployment = normalizeDeploymentCapability(options.deployment, options.runtimeClassification);
    this.mutationLocks = options.mutationLockManager ?? new FilesystemWorkAreaMutationLockManager({ serverStateRoot: this.deployment.serverStateRoot });
  }

  initialize(): Promise<void> {
    if (this.deploymentReady) return this.deploymentReady;
    const attempt = this.options.registry.assertRegistryKind(this.deployment.registryKind)
      .then(() => this.mutationLocks.initialize()).then(async ({ canonicalLockRoot, hostIdentityDigest }) => {
        const { legacyDomainDigest, domainDigest } = deploymentDomainDigests(this.deployment, canonicalLockRoot, hostIdentityDigest);
        await this.options.registry.assertDeploymentLockDomain({ lockDomainId: this.deployment.lockDomainId, domainDigest, legacyDomainDigest,
          deploymentMode: this.deployment.mode, hostIdentityDigest });
      });
    let guarded: Promise<void>;
    guarded = attempt.catch((error) => { if (this.deploymentReady === guarded) this.deploymentReady = null; throw error; });
    this.deploymentReady = guarded;
    return guarded;
  }

  async createOrReuse(request: WorkflowWorkAreaRequest): Promise<WorkflowWorkAreaReadModel> {
    await this.initialize();
    const input = normalizeRequest(request);
    if (!await this.options.authorizer.authorize(input)) throw new WorkflowWorkAreaError('not_authorized', 'This role is not authorized to use task work capacity.');
    const workspace = await this.options.workspaceRegistry.getWorkspace(input.workspaceId);
    if (!workspace || workspace.workspaceId !== input.workspaceId) throw new WorkflowWorkAreaError('not_found', 'Workspace registration was not found.');
    const selected = selectRepositories(workspace.repositories, input.repoKeys, input.kind === 'preflight');
    const canonicalRoot = await validateWorkspaceLayout(workspace);
    const allPrepared = await Promise.all([...workspace.repositories].sort((a, b) => a.repoKey.localeCompare(b.repoKey)).map((repo) => this.prepare(repo)));
    const byKey = new Map(allPrepared.map((repo) => [repo.repoKey, repo]));
    const prepared = selected.map((repo) => byKey.get(repo.repoKey)!);
    const layoutDigest = stableDigest({ workspaceId: input.workspaceId, workspaceRoot: canonicalRoot, mode: input.mode,
      repositories: allPrepared.map((repo) => ({ repoKey: repo.repoKey, repositoryRoot: repo.source.canonicalRepositoryRoot,
        commonDirIdentity: repo.source.commonDirIdentity, sourceRevision: repo.source.sourceRevision })) });
    const requestDigest = stableDigest({ ...input, repoKeys: prepared.map((repo) => repo.repoKey), layoutDigest });
    const estimate = this.options.estimateReservationBytes?.({ workspaceId: input.workspaceId, repositoryCount: allPrepared.length, mode: input.mode })
      ?? allPrepared.length * DEFAULT_RESERVATION_PER_REPOSITORY;
    const reserveBytes = Math.min(Number.MAX_SAFE_INTEGER, Math.max(this.minimumReservation * allPrepared.length, Number.isSafeInteger(estimate) && estimate > 0 ? estimate : 0));
    const reservation = await this.options.registry.reserve({ ...input, layoutDigest, requestDigest, reserveBytes, countLimit: this.countLimit, byteLimit: this.byteLimit });
    const managedRoot = join(canonicalRoot, '.workflow-workareas'); const areaRoot = join(managedRoot, reservation.area.workAreaId);
    try {
      await ensurePrivateDirectory(managedRoot, workspace.repositories.map((r) => r.repositoryRoot));
      await ensurePrivateDirectory(areaRoot, workspace.repositories.map((r) => r.repositoryRoot));
      await ensurePrivateDirectory(join(areaRoot, 'repos'), workspace.repositories.map((r) => r.repositoryRoot));
      let failed = false; let ownershipLost = false;
      for (const repo of prepared) {
        try { await this.withLease(reservation, repo, areaRoot, requestDigest); }
        catch (error) { failed = true;
          if (error instanceof WorkAreaLeaseLostError) { ownershipLost = true; break; }
          else await this.retainIfNeeded(reservation.area.workAreaId, repo, error);
        }
      }
      const rows = await this.options.registry.listRepositories(reservation.area.workAreaId);
      const status = failed || rows.some((r) => r.status === 'retained') ? 'retained' : rows.some((r) => r.status !== 'ready') ? 'blocked' : 'ready';
      if (ownershipLost) await this.options.registry.blockOperation(reservation.operationId, 'Task work preparation ownership changed; reconciliation is required.');
      else await this.options.registry.finish(reservation.area.workAreaId, reservation.operationId, status, input.actorId, status === 'ready' ? 'Task work area is ready.' : 'Task work area setup needs safe recovery.');
      if (ownershipLost) { const model = await this.readModel(reservation.area.workAreaId); return { ...model, status: 'retained', nextAction: 'Reconcile this task work area before retrying.' }; }
    } catch (error) { await this.options.registry.finish(reservation.area.workAreaId, reservation.operationId, 'retained', input.actorId, safeFailure(error)); }
    return this.readModel(reservation.area.workAreaId);
  }
  reconcile(request: Omit<WorkflowWorkAreaRequest, 'kind'>) { return this.createOrReuse({ ...request, kind: 'reconcile' }); }
  private async prepare(repo: RegisteredWorkAreaRepository): Promise<PreparedRepository> { return { ...repo, source: await this.driver.resolveSource(repo) }; }

  private async withLease(reservation: { area: Selectable<WorkflowWorkArea>; operationId: string }, repo: PreparedRepository, areaRoot: string, requestDigest: string) {
    const holderId = randomUUID(); const leaseKey = `${reservation.area.workAreaId}:${repo.repoKey}`; const deadline = this.now() + this.leaseWait;
    let claim: { acquired: boolean; fence: number; expiresAt: number };
    do { claim = await this.options.registry.claimLease({ leaseKey, workAreaId: reservation.area.workAreaId, repoKey: repo.repoKey,
      operationId: reservation.operationId, requestDigest, holderId, ttlMs: this.leaseTtl });
      if (!claim.acquired) await delay(Math.min(25, Math.max(1, claim.expiresAt - this.now())));
    } while (!claim.acquired && this.now() < deadline);
    if (!claim.acquired) throw new WorkflowWorkAreaError('operation_busy', 'Task work preparation is already in progress.');
    let leaseLost = false;
    const heartbeat = async () => { try { if (!await this.options.registry.heartbeatLease(leaseKey, holderId, claim.fence, this.leaseTtl)) leaseLost = true; } catch { leaseLost = true; } };
    const timer = setInterval(() => { void heartbeat(); }, Math.max(10, Math.floor(this.leaseTtl / 3)));
    let filesystemLock: WorkAreaMutationLock | null = null;
    try {
      filesystemLock = await this.mutationLocks.acquire({ sourceIdentity: repo.source.commonDirIdentity,
        targetIdentity: join(areaRoot, 'repos', repo.repoKey), holderId, waitMs: this.leaseWait });
      const assertLease = async () => { if (leaseLost) throw new WorkAreaLeaseLostError(); await heartbeat();
        if (leaseLost) throw new WorkAreaLeaseLostError(); };
      await this.ensureRepository(reservation.area, repo, areaRoot, assertLease);
      await assertLease();
    } finally { clearInterval(timer); await filesystemLock?.release(); await this.options.registry.releaseLease(leaseKey, holderId, claim.fence); }
  }

  private async ensureRepository(area: Selectable<WorkflowWorkArea>, repo: PreparedRepository, areaRoot: string, assertLease: () => Promise<void>) {
    const target = join(areaRoot, 'repos', repo.repoKey); assertContained(areaRoot, target); await assertNoSymlinkPath(areaRoot, target);
    const refreshed = await this.driver.resolveSource(repo);
    if (identityDigest(refreshed) !== identityDigest(repo.source)) throw conflict('The confirmed repository revision changed during setup.');
    let state = await this.driver.inspect({ source: repo.source, worktreeRoot: target });
    if (!state.exists) {
      await assertLease();
      await this.options.registry.upsertRepository({ workAreaId: area.workAreaId, repoKey: repo.repoKey, sourceRevision: repo.source.sourceRevision,
        sourceIdentity: repo.source.commonDirIdentity, status: 'creating' });
      await assertLease();
      // A filesystem lock may have been waited on after the first inspection.
      // Reconcile both target and source registry immediately before mutation.
      state = await this.driver.inspect({ source: repo.source, worktreeRoot: target });
      if (state.exists) {
        if (!state.valid) throw conflict('Repository ownership could not be verified; task work was retained.');
      } else {
        await assertLease();
        await this.driver.create({ source: repo.source, worktreeRoot: target });
      }
      state = await this.driver.inspect({ source: repo.source, worktreeRoot: target });
    }
    await verifyPostCreateContainment(areaRoot, target);
    await assertLease();
    const status = state.valid && !state.dirty && !state.active && !state.uniqueWork ? 'ready' : state.dirty || state.active || state.uniqueWork ? 'retained' : 'blocked';
    await this.options.registry.upsertRepository({ workAreaId: area.workAreaId, repoKey: repo.repoKey, sourceRevision: repo.source.sourceRevision,
      sourceIdentity: repo.source.commonDirIdentity, status, ...state, retainReason: status === 'ready' ? null : retentionMessage(state) });
    if (status !== 'ready') throw conflict(retentionMessage(state));
  }
  private async retainIfNeeded(areaId: string, repo: PreparedRepository, error: unknown) {
    const existing = (await this.options.registry.listRepositories(areaId)).find((r) => r.repoKey === repo.repoKey);
    if (!existing || existing.status === 'creating' || existing.status === 'reserved') await this.options.registry.upsertRepository({ workAreaId: areaId,
      repoKey: repo.repoKey, sourceRevision: repo.source.sourceRevision, sourceIdentity: repo.source.commonDirIdentity, status: 'retained', retainReason: safeFailure(error) });
  }
  private async readModel(id: string): Promise<WorkflowWorkAreaReadModel> {
    const area = await this.options.registry.get(id); if (!area) throw new WorkflowWorkAreaError('not_found', 'Task work area was not found.');
    const rows = await this.options.registry.listRepositories(id); const status = area.status === 'ready' ? 'ready' : area.status === 'retained' ? 'retained' : 'blocked';
    return { workAreaId: area.workAreaId, workspaceId: area.workspaceId, lineageKey: area.lineageKey, ownerRunId: area.ownerRunId, generation: area.generation, status,
      repositories: rows.map((r) => ({ repoKey: safeId(r.repoKey, 'repository'), status: r.status === 'ready' ? 'ready' : r.status === 'retained' ? 'retained' : 'blocked',
        dirty: Boolean(r.dirty), active: Boolean(r.active), uniqueWork: Boolean(r.uniqueWork), message: r.status === 'ready' ? 'Repository work area is ready.' : sanitizeGasCityProviderText(r.retainReason ?? 'Repository work area needs recovery.', 'Repository work area needs recovery.') })),
      capacity: { estimatedReservedBytes: area.reservedBytes, accounting: 'estimated_reservation' },
      nextAction: status === 'ready' ? 'Continue the authorized task in this work area.' : 'Inspect and recover this retained task work area before retrying.' };
  }
}

export class GitWorkflowWorktreeDriver implements WorkflowWorktreeDriver {
  async resolveSource(input: { repositoryRoot: string; sourceRevision: string }): Promise<WorktreeSourceIdentity> {
    const canonicalRepositoryRoot = await realpath(input.repositoryRoot);
    const [common, revision] = await Promise.all([git(canonicalRepositoryRoot, ['rev-parse', '--git-common-dir']), git(canonicalRepositoryRoot, ['rev-parse', `${input.sourceRevision}^{commit}`])]);
    const commonDirIdentity = await realpath(resolve(canonicalRepositoryRoot, common));
    if (!/^[0-9a-f]{40,64}$/i.test(revision)) throw new WorkflowWorkAreaError('unsafe_layout', 'Repository revision could not be verified.');
    return { canonicalRepositoryRoot, commonDirIdentity, sourceRevision: revision };
  }
  async inspect(input: { source: WorktreeSourceIdentity; worktreeRoot: string }): Promise<WorktreeInspection> {
    if (!await pathExists(input.worktreeRoot)) return { exists: false, valid: false, dirty: false, active: false, uniqueWork: false };
    try {
      const canonicalTarget = await realpath(input.worktreeRoot);
      const [topRaw, commonRaw, head, status, list] = await Promise.all([git(canonicalTarget, ['rev-parse', '--show-toplevel']), git(canonicalTarget, ['rev-parse', '--git-common-dir']),
        git(canonicalTarget, ['rev-parse', 'HEAD']), git(canonicalTarget, ['status', '--porcelain']),
        git(input.source.canonicalRepositoryRoot, ['-c', 'core.quotePath=false', 'worktree', 'list', '--porcelain', '-z'])]);
      const top = await realpath(resolve(canonicalTarget, topRaw)); const common = await realpath(resolve(canonicalTarget, commonRaw));
      const registered = await worktreeListContains(list, canonicalTarget);
      const ownership = common === input.source.commonDirIdentity && top === canonicalTarget && registered;
      return { exists: true, valid: ownership, dirty: Boolean(status), active: false, uniqueWork: head !== input.source.sourceRevision,
        sourceRevision: head, ownershipIdentity: common };
    } catch { return { exists: true, valid: false, dirty: false, active: false, uniqueWork: true }; }
  }
  async create(input: { source: WorktreeSourceIdentity; worktreeRoot: string }) {
    await execFile('git', ['-C', input.source.canonicalRepositoryRoot, 'worktree', 'add', '--detach', input.worktreeRoot, input.source.sourceRevision]);
  }
}

interface VkWorkAreaRegistryClient { getWorkspace(id: string): Promise<{ id: string; container_ref: string | null }>; getWorkspaceRepos(id: string): Promise<Array<{ id: string; target_branch: string }>>; listRepos(): Promise<Array<{ id: string; path: string; name: string }>> }
export class VkWorkflowWorkAreaWorkspaceRegistry implements WorkflowWorkAreaWorkspaceRegistry {
  constructor(private readonly vk: VkWorkAreaRegistryClient) {}
  async getWorkspace(workspaceId: string): Promise<RegisteredWorkAreaWorkspace | null> {
    try { const [workspace, links, repos] = await Promise.all([this.vk.getWorkspace(workspaceId), this.vk.getWorkspaceRepos(workspaceId), this.vk.listRepos()]);
      if (!workspace.container_ref || !isAbsolute(workspace.container_ref)) return null; const byId = new Map(repos.map((r) => [r.id, r]));
      const repositories = await Promise.all(links.map(async (link) => { const repo = byId.get(link.id);
        if (!repo || !isAbsolute(repo.path)) throw new WorkflowWorkAreaError('unsafe_layout', 'Workspace repository registration is incomplete.');
        const sourceRevision = await git(repo.path, ['rev-parse', `${link.target_branch}^{commit}`]);
        return { repoKey: repo.id, repositoryRoot: repo.path, sourceRevision }; }));
      return { workspaceId: workspace.id, workspaceRoot: workspace.container_ref, repositories };
    } catch (error) { if (error instanceof WorkflowWorkAreaError) throw error; return null; }
  }
}

function normalizeRequest(r: WorkflowWorkAreaRequest): WorkflowWorkAreaRequest {
  const value = { ...r, workspaceId: requiredId(r.workspaceId, 'workspace'), lineageKey: requiredId(r.lineageKey, 'task lineage'), ownerRunId: requiredId(r.ownerRunId, 'owner run'),
    operationKey: requiredId(r.operationKey, 'operation'), actorId: requiredId(r.actorId, 'actor'), roleId: requiredId(r.roleId, 'role'), repoKeys: r.repoKeys?.map((k) => requiredId(k, 'repository')) };
  if (value.repoKeys && new Set(value.repoKeys).size !== value.repoKeys.length) throw new WorkflowWorkAreaError('invalid_request', 'Repository selection contains duplicates.'); return value;
}
function selectRepositories(all: RegisteredWorkAreaRepository[], requested: string[] | undefined, preflight: boolean) {
  const byKey = new Map(all.map((r) => [requiredId(r.repoKey, 'registered repository'), r])); const keys = preflight || !requested ? [...byKey.keys()].sort() : requested;
  if (!keys.length) throw new WorkflowWorkAreaError('invalid_request', 'At least one registered repository is required.'); return keys.map((key) => {
    const repo = byKey.get(key); if (!repo) throw new WorkflowWorkAreaError('not_authorized', 'A requested repository is not registered for this workspace.');
    if (!isAbsolute(repo.repositoryRoot) || !repo.sourceRevision.trim()) throw new WorkflowWorkAreaError('unsafe_layout', 'Workspace repository registration is incomplete.'); return repo; });
}
async function validateWorkspaceLayout(workspace: RegisteredWorkAreaWorkspace) {
  if (!isAbsolute(workspace.workspaceRoot)) throw new WorkflowWorkAreaError('unsafe_layout', 'Workspace storage registration is invalid.');
  const root = await realpath(workspace.workspaceRoot); const managed = join(root, '.workflow-workareas');
  for (const repo of workspace.repositories) if (contains(await realpath(repo.repositoryRoot), managed)) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage must remain outside repositories.'); return root;
}
async function ensurePrivateDirectory(path: string, repositories: string[]) {
  for (const repo of repositories) if (contains(await realpath(repo), resolve(path))) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage must remain outside repositories.');
  await assertNoSymlinkPath(await nearestExistingParent(path), path); await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700);
  const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isDirectory() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage ownership could not be verified.');
}
async function verifyPostCreateContainment(root: string, target: string) { await assertNoSymlinkPath(root, target); const canonicalRoot = await realpath(root); const canonicalTarget = await realpath(target);
  if (!contains(canonicalRoot, canonicalTarget)) throw new WorkflowWorkAreaError('unsafe_layout', 'Created task work escaped its assigned root.'); }
async function nearestExistingParent(path: string): Promise<string> { let cursor = resolve(path); while (!await pathExists(cursor)) { const parent = resolve(cursor, '..'); if (parent === cursor) break; cursor = parent; } return cursor; }
async function assertNoSymlinkPath(root: string, target: string) { assertContained(root, target); let cursor = resolve(root); for (const part of relative(cursor, resolve(target)).split(sep).filter(Boolean)) {
  cursor = join(cursor, part); const stat = await lstat(cursor).catch((e: NodeJS.ErrnoException) => e.code === 'ENOENT' ? null : Promise.reject(e)); if (stat?.isSymbolicLink()) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage contains an unsupported link.'); } }
function assertContained(root: string, target: string) { if (!contains(resolve(root), resolve(target))) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage escaped its assigned root.'); }
function contains(root: string, target: string) { const r = relative(root, target); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); }
async function worktreeListContains(output: string, target: string) { for (const line of output.split(/[\0\n]/)) if (line.startsWith('worktree ')) { const path = line.slice(9); try { if (await realpath(path) === target) return true; } catch {} } return false; }
async function git(root: string, args: string[]) { return (await execFile('git', ['-C', root, ...args])).stdout.trim(); }
function pathExists(path: string) { return lstat(path).then(() => true, (e: NodeJS.ErrnoException) => e.code === 'ENOENT' ? false : Promise.reject(e)); }
function assertAreaIdentity(area: Selectable<WorkflowWorkArea>, input: Pick<ReservationInput, 'ownerRunId' | 'layoutDigest'>) { if (area.ownerRunId !== input.ownerRunId) throw conflict('This task lineage belongs to another run.'); if (area.layoutDigest !== input.layoutDigest) throw conflict('Workspace repository registration changed for this task lineage.'); }
function retentionMessage(s: WorktreeInspection) { if (!s.valid) return 'Repository ownership could not be verified; task work was retained.'; if (s.active) return 'Task work is active and must be retained.'; if (s.dirty) return 'Task work contains uncommitted changes and must be retained.'; if (s.uniqueWork) return 'Task work contains unique changes and must be retained.'; return 'Task work state could not be verified and must be retained.'; }
function safeFailure(error: unknown) { return error instanceof WorkflowWorkAreaError ? sanitizeGasCityProviderText(error.message, 'Task work area needs recovery.') : 'Task work area setup did not finish. It was retained for safe recovery.'; }
function requiredId(value: string, label: string) { const id = value.trim(); if (!SAFE_ID.test(id)) throw new WorkflowWorkAreaError('invalid_request', `A valid ${label} identifier is required.`); return id; }
function safeId(value: string, fallback: string) { return SAFE_ID.test(value) ? value : fallback; }
function stableDigest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function stableOpaqueId(prefix: string, value: string) { return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`; }
function identityDigest(i: WorktreeSourceIdentity) { return stableDigest(i); }
function deploymentDomainDigests(deployment: ReturnType<typeof normalizeDeploymentCapability>, canonicalLockRoot: string, hostIdentityDigest: string) {
  const legacyDomainDigest = stableDigest({ mode: deployment.mode, lockDomainId: deployment.lockDomainId, hostId: deployment.hostId, canonicalLockRoot });
  return { legacyDomainDigest, domainDigest: stableDigest({ mode: deployment.mode, lockDomainId: deployment.lockDomainId,
    hostId: deployment.hostId, canonicalLockRoot, hostIdentityDigest }) };
}
async function assertCompatibleLegacyRegistry(trx: Transaction<DB>) {
  const [areas, repositories, operations, leases, audits] = await Promise.all([
    trx.selectFrom('WorkflowWorkArea').selectAll().execute(), trx.selectFrom('WorkflowWorkAreaRepository').selectAll().execute(),
    trx.selectFrom('WorkflowWorkAreaOperation').selectAll().execute(), trx.selectFrom('WorkflowWorkAreaOperationLease').selectAll().execute(),
    trx.selectFrom('WorkflowWorkAreaAuditEvent').selectAll().execute(),
  ]);
  const areaById = new Map(areas.map((area) => [area.workAreaId, area])); const operationById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const compatible = areas.every((area) => Boolean(area.layoutDigest) && area.reservedBytes >= 0 && area.generation > 0)
    && repositories.every((repo) => Boolean(repo.sourceIdentity) && Boolean(repo.sourceRevision) && areaById.has(repo.workAreaId))
    && operations.every((operation) => areaById.has(operation.workAreaId) && Boolean(operation.requestDigest))
    && leases.every((lease) => areaById.has(lease.workAreaId) && operationById.get(lease.operationId)?.workAreaId === lease.workAreaId && lease.fence > 0)
    && audits.every((audit) => areaById.get(audit.workAreaId)?.workspaceId === audit.workspaceId && (audit.operationId === null || operationById.has(audit.operationId)));
  if (!compatible) throw conflict('Legacy task work registry contents require manual reconciliation before adoption.');
}
function conflict(message: string) { return new WorkflowWorkAreaError('conflict', message); }
function delay(ms: number) { return new Promise<void>((done) => setTimeout(done, ms)); }
async function readLockOwner(path: string): Promise<MutationLockOwner | null> { try { const value = JSON.parse(await readFile(path, 'utf8')) as Partial<MutationLockOwner>;
  return typeof value.holderId === 'string' && Number.isSafeInteger(value.pid) && typeof value.processIdentity === 'string' && typeof value.createdAt === 'number' ? value as MutationLockOwner : null;
} catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return null; } }
function ignoreMissing(error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
async function prepareGlobalLockRoot(serverStateRoot: string): Promise<string> {
  const configured = resolve(serverStateRoot);
  await mkdir(configured, { recursive: true, mode: 0o700 });
  const configuredStat = await lstat(configured);
  if (configuredStat.isSymbolicLink() || !configuredStat.isDirectory() || (typeof process.getuid === 'function' && configuredStat.uid !== process.getuid())) {
    throw new WorkflowWorkAreaError('unsafe_layout', 'Server work-area lock storage could not be verified.');
  }
  const canonicalStateRoot = await realpath(configured);
  const lockRoot = join(canonicalStateRoot, '.workflow-workarea-locks');
  assertContained(canonicalStateRoot, lockRoot);
  await ensurePrivateDirectory(lockRoot, []);
  return lockRoot;
}
async function validateGlobalLockCapability(serverStateRoot: string, createLink: typeof link, sync: (path: string) => Promise<void>, identify: () => Promise<string>, identifyHost: () => Promise<string>) {
  const canonicalLockRoot = await prepareGlobalLockRoot(serverStateRoot);
  const processIdentity = await identify();
  if (!processIdentity || processIdentity.startsWith('unverifiable:')) throw new WorkflowWorkAreaError('unsafe_layout', 'Server process identity capability could not be verified.');
  const probe = `.capability-${process.pid}-${randomUUID()}`; const owner = join(canonicalLockRoot, `${probe}.owner`); const claim = join(canonicalLockRoot, `${probe}.lock`);
  try {
    const file = await open(owner, 'wx', 0o600); try { await file.writeFile('capability'); await file.sync(); } finally { await file.close(); }
    await sync(canonicalLockRoot); await createLink(owner, claim); await sync(canonicalLockRoot);
    const ownerStat = await stat(owner); const claimStat = await stat(claim);
    if (ownerStat.ino !== claimStat.ino || ownerStat.dev !== claimStat.dev) throw new WorkflowWorkAreaError('unsafe_layout', 'Server lock storage does not provide reliable atomic claims.');
  } catch (error) {
    if (error instanceof WorkflowWorkAreaError) throw error;
    throw new WorkflowWorkAreaError('unsafe_layout', 'Server lock storage capability could not be verified.');
  } finally {
    await unlink(claim).catch(ignoreMissing); await unlink(owner).catch(ignoreMissing); await sync(canonicalLockRoot).catch(() => undefined);
  }
  const hostIdentityDigest = await ensurePrivateHostIdentity(resolve(canonicalLockRoot, '..'), await identifyHost(), createLink, sync);
  return { canonicalLockRoot, hostIdentityDigest };
}
function normalizeDeploymentCapability(capability: WorkAreaDeploymentCapability | undefined, classification: ProductionWorkflowWorkAreaProviderOptions['runtimeClassification']) {
  if (!capability) throw new WorkflowWorkAreaError('unsafe_layout', 'A work-area deployment capability is required.');
  if (capability.mode === 'production_single_host') {
    if (classification !== 'production') throw new WorkflowWorkAreaError('unsafe_layout', 'Production work-area capability requires production runtime classification.');
    const serverStateRoot = capability.serverStateRoot?.trim(); const lockDomainId = requiredId(capability.lockDomainId, 'lock domain'); const hostId = requiredId(capability.hostId, 'host');
    if (!serverStateRoot || !isAbsolute(serverStateRoot)) throw new WorkflowWorkAreaError('unsafe_layout', 'Production lock storage must be explicitly configured.');
    return { mode: capability.mode, registryKind: 'production' as const, serverStateRoot, lockDomainId, hostId };
  }
  if (classification === 'production' || capability.unsafeDevelopmentOptIn !== true) throw new WorkflowWorkAreaError('unsafe_layout', 'Temporary work-area capability is not allowed in production.');
  return { mode: capability.mode, registryKind: 'development' as const, serverStateRoot: capability.serverStateRoot ?? join(tmpdir(), `vd-workarea-development-${process.pid}`),
    lockDomainId: `unsafe-development-${requiredId(capability.registryNamespace, 'development registry namespace')}`, hostId: `process-${process.pid}` };
}
async function ensurePrivateHostIdentity(stateRoot: string, runtimeHostIdentity: string, createLink: typeof link, sync: (path: string) => Promise<void>) {
  if (!runtimeHostIdentity.trim()) throw new WorkflowWorkAreaError('unsafe_layout', 'Server host identity capability could not be verified.');
  const path = join(stateRoot, '.workflow-workarea-host-identity'); const temporary = `${path}.${process.pid}.${randomUUID()}.owner`;
  const record = { version: 1, instanceId: randomUUID(), hostFingerprintDigest: stableDigest(runtimeHostIdentity) };
  const file = await open(temporary, 'wx', 0o600); try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
  await sync(stateRoot);
  try { await createLink(temporary, path); await sync(stateRoot); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new WorkflowWorkAreaError('unsafe_layout', 'Server host identity could not be established.'); }
  finally { await unlink(temporary).catch(ignoreMissing); await sync(stateRoot); }
  const identityStat = await lstat(path);
  if (!identityStat.isFile() || identityStat.isSymbolicLink() || (identityStat.mode & 0o077) !== 0
    || (typeof process.getuid === 'function' && identityStat.uid !== process.getuid())) throw new WorkflowWorkAreaError('unsafe_layout', 'Server host identity storage could not be verified.');
  let stored: typeof record;
  try { stored = JSON.parse(await readFile(path, 'utf8')) as typeof record; } catch { throw new WorkflowWorkAreaError('unsafe_layout', 'Server host identity could not be read.'); }
  if (stored.version !== 1 || !/^[0-9a-f-]{36}$/i.test(stored.instanceId) || stored.hostFingerprintDigest !== stableDigest(runtimeHostIdentity)) {
    throw new WorkflowWorkAreaError('conflict', 'Server host identity does not match this work-area deployment.');
  }
  return stableDigest({ instanceId: stored.instanceId, hostFingerprintDigest: stored.hostFingerprintDigest });
}
async function deriveRuntimeHostIdentity(): Promise<string> {
  if (process.platform === 'linux') { const value = (await readFile('/etc/machine-id', 'utf8')).trim(); if (value) return `linux-machine:${value}`; }
  if (process.platform === 'darwin') {
    const output = (await execFile('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])).stdout;
    const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/); if (match?.[1]) return `darwin-platform:${match[1]}`;
  }
  throw new WorkflowWorkAreaError('unsafe_layout', 'Server host identity capability could not be verified.');
}
async function fsyncDirectory(path: string): Promise<void> { const directory = await open(path, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
async function cleanupLockMetadata(lockRoot: string, limit: number, inspect: (pid: number, expected: string) => Promise<ProcessIdentityState>, sync: (path: string) => Promise<void>) {
  const entries = await readdir(lockRoot);
  const stale = entries.filter((name) => name.endsWith('.stale'));
  if (stale.length > limit) {
    const ordered = await Promise.all(stale.map(async (name) => ({ name, mtime: (await stat(join(lockRoot, name))).mtimeMs })));
    for (const entry of ordered.sort((a, b) => a.mtime - b.mtime).slice(0, stale.length - limit)) await unlink(join(lockRoot, entry.name)).catch(ignoreMissing);
    await sync(lockRoot);
  }
  const owners = entries.filter((name) => name.endsWith('.owner'));
  for (const name of owners) {
    const path = join(lockRoot, name); const owner = await readLockOwner(path);
    if (owner && await inspect(owner.pid, owner.processIdentity) === 'different') await unlink(path).catch(ignoreMissing);
  }
  const remainingOwners = (await readdir(lockRoot)).filter((name) => name.endsWith('.owner'));
  if (remainingOwners.length >= limit) throw new WorkflowWorkAreaError('operation_busy', 'Task work lock metadata needs reconciliation.');
  if (owners.length !== remainingOwners.length) await sync(lockRoot);
}
async function currentProcessIdentity(): Promise<string> { const identity = await readProcessIdentity(process.pid); return identity ?? `unverifiable:${process.pid}:${randomUUID()}`; }
async function inspectProcessIdentity(pid: number, expected: string): Promise<ProcessIdentityState> { const actual = await readProcessIdentity(pid);
  if (actual) return classifyProcessIdentity(actual, expected);
  try { process.kill(pid, 0); return 'unknown'; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'different' : 'unknown'; } }
export function classifyProcessIdentity(actual: string, expected: string): ProcessIdentityState {
  if (actual !== expected) return 'different';
  // macOS ps exposes process start only to whole seconds. A recycled PID in
  // the same second cannot be distinguished, so retain the claim for explicit
  // reconciliation rather than risking concurrent Git mutation.
  return actual.startsWith('darwin-second:') ? 'unknown' : 'same';
}
async function readProcessIdentity(pid: number): Promise<string | null> { try {
  if (process.platform === 'linux') { const stat = await readFile(`/proc/${pid}/stat`, 'utf8'); const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' '); return fields[19] ? `linux:${fields[19]}` : null; }
  if (process.platform === 'darwin') { const started = (await execFile('ps', ['-o', 'lstart=', '-p', String(pid)])).stdout.trim(); return started ? `darwin-second:${started}` : null; }
  return null;
} catch { return null; } }
async function retrySqliteBusy<T>(operation: () => Promise<T>): Promise<T> { let last: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) { try { return await operation(); } catch (error) {
    last = error; if (!String((error as Error)?.message ?? error).includes('SQLITE_BUSY')) throw error; await delay(5 * (attempt + 1)); } }
  throw last;
}
async function requireArea(trx: Transaction<DB>, id: string) { const area = await trx.selectFrom('WorkflowWorkArea').selectAll().where('workAreaId', '=', id).executeTakeFirst(); if (!area) throw new WorkflowWorkAreaError('not_found', 'Task work area was not found.'); return area; }
