import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type {
  DB,
  WorkflowWorkArea,
  WorkflowWorkAreaRepository,
  WorkflowWorkAreaStatus,
} from '../../../../store/kysely_types';
import { sanitizeGasCityProviderText } from './gasCityWorkflowProvider';

const execFile = promisify(execFileCallback);
const CONSUMING_STATUSES: WorkflowWorkAreaStatus[] = ['reserved', 'provisioning', 'ready', 'blocked', 'retained'];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

export type WorkAreaOperationKind = 'preflight' | 'create_or_reuse' | 'reconcile';
export type WorkAreaResultStatus = 'ready' | 'blocked' | 'retained';

export interface RegisteredWorkAreaRepository {
  repoKey: string;
  /** Server-owned source checkout. Never serialize this into product output. */
  repositoryRoot: string;
  sourceRevision: string;
}

export interface RegisteredWorkAreaWorkspace {
  workspaceId: string;
  /** Server-owned multi-repository root. */
  workspaceRoot: string;
  repositories: RegisteredWorkAreaRepository[];
}

export interface WorkflowWorkAreaWorkspaceRegistry {
  getWorkspace(workspaceId: string): Promise<RegisteredWorkAreaWorkspace | null>;
}

export interface WorkflowWorkAreaAuthorizer {
  authorize(input: {
    workspaceId: string;
    lineageKey: string;
    ownerRunId: string;
    actorId: string;
    roleId: string;
    mode: 'read' | 'write';
  }): Promise<boolean>;
}

export interface WorktreeInspection {
  exists: boolean;
  valid: boolean;
  dirty: boolean;
  active: boolean;
  uniqueWork: boolean;
  sourceRevision?: string;
}

export interface WorkflowWorktreeDriver {
  inspect(input: { repositoryRoot: string; worktreeRoot: string; sourceRevision: string }): Promise<WorktreeInspection>;
  create(input: { repositoryRoot: string; worktreeRoot: string; sourceRevision: string }): Promise<void>;
}

export interface WorkflowWorkAreaRequest {
  workspaceId: string;
  lineageKey: string;
  ownerRunId: string;
  operationKey: string;
  actorId: string;
  roleId: string;
  mode: 'read' | 'write';
  kind: WorkAreaOperationKind;
  /** Opaque registered repository keys only. Omit during preflight to provision every registered repository. */
  repoKeys?: string[];
  reserveBytes: number;
}

export interface WorkflowWorkAreaReadModel {
  workAreaId: string;
  workspaceId: string;
  lineageKey: string;
  ownerRunId: string;
  generation: number;
  status: WorkAreaResultStatus;
  repositories: Array<{
    repoKey: string;
    status: 'ready' | 'blocked' | 'retained';
    dirty: boolean;
    active: boolean;
    uniqueWork: boolean;
    message: string;
  }>;
  capacity: { reservedBytes: number };
  nextAction: string;
}

export class WorkflowWorkAreaError extends Error {
  constructor(public readonly code: 'invalid_request' | 'not_authorized' | 'not_found' | 'conflict' | 'quota_exceeded' | 'unsafe_layout', message: string) {
    super(message);
    this.name = 'WorkflowWorkAreaError';
  }
}

export interface DbWorkflowWorkAreaRegistryOptions {
  db: Kysely<DB>;
  now?: () => number;
}

interface ReservationInput {
  workspaceId: string;
  lineageKey: string;
  ownerRunId: string;
  layoutDigest: string;
  operationKey: string;
  requestDigest: string;
  actorId: string;
  kind: WorkAreaOperationKind;
  reserveBytes: number;
  countLimit: number;
  byteLimit: number;
}

export class DbWorkflowWorkAreaRegistry {
  private readonly db: Kysely<DB>;
  private readonly now: () => number;

  constructor(options: DbWorkflowWorkAreaRegistryOptions) {
    this.db = options.db;
    this.now = options.now ?? (() => Date.now());
  }

  async reserve(input: ReservationInput): Promise<{ area: Selectable<WorkflowWorkArea>; operationId: string; reused: boolean }> {
    return this.db.transaction().execute(async (trx) => {
      const existingOperation = await trx.selectFrom('WorkflowWorkAreaOperation').selectAll().where('operationKey', '=', input.operationKey).executeTakeFirst();
      if (existingOperation) {
        if (existingOperation.requestDigest !== input.requestDigest) throw new WorkflowWorkAreaError('conflict', 'This operation key belongs to different work.');
        const area = await requireArea(trx, existingOperation.workAreaId);
        return { area, operationId: existingOperation.operationId, reused: true };
      }

      const existingArea = await trx.selectFrom('WorkflowWorkArea').selectAll()
        .where('workspaceId', '=', input.workspaceId).where('lineageKey', '=', input.lineageKey).executeTakeFirst();
      if (existingArea && existingArea.ownerRunId !== input.ownerRunId) {
        throw new WorkflowWorkAreaError('conflict', 'This task lineage belongs to another run.');
      }
      if (existingArea && existingArea.layoutDigest !== input.layoutDigest) {
        throw new WorkflowWorkAreaError('conflict', 'Workspace repository registration changed for this task lineage.');
      }

      const area = existingArea ?? await this.insertWithinQuota(trx, input);
      const operationId = randomUUID();
      const now = this.now();
      try {
        await trx.insertInto('WorkflowWorkAreaOperation').values({
          operationId,
          operationKey: input.operationKey,
          requestDigest: input.requestDigest,
          workAreaId: area.workAreaId,
          actorId: input.actorId,
          kind: input.kind,
          status: 'preparing',
          message: 'Preparing isolated task work.',
          createdAt: now,
          updatedAt: now,
        }).execute();
      } catch {
        const raced = await trx.selectFrom('WorkflowWorkAreaOperation').selectAll().where('operationKey', '=', input.operationKey).executeTakeFirst();
        if (!raced || raced.requestDigest !== input.requestDigest) throw new WorkflowWorkAreaError('conflict', 'This operation key belongs to different work.');
        return { area: await requireArea(trx, raced.workAreaId), operationId: raced.operationId, reused: true };
      }
      await this.audit(trx, area, operationId, input.actorId, existingArea ? 'operation_reused_area' : 'area_reserved', existingArea ? 'Existing task work area selected.' : 'Task work area capacity reserved.');
      return { area, operationId, reused: Boolean(existingArea) };
    });
  }

  private async insertWithinQuota(trx: Transaction<DB>, input: ReservationInput): Promise<Selectable<WorkflowWorkArea>> {
    const now = this.now();
    const area: Selectable<WorkflowWorkArea> = {
      workAreaId: randomUUID(), workspaceId: input.workspaceId, lineageKey: input.lineageKey,
      ownerRunId: input.ownerRunId, layoutDigest: input.layoutDigest, status: 'reserved', generation: 1,
      reservedBytes: input.reserveBytes, retainReason: null, createdAt: now, updatedAt: now,
    };
    try {
      // One conditional write makes count and byte admission atomic across server
      // instances sharing this SQLite registry. A deferred read transaction alone
      // would permit two contenders to observe the same remaining capacity.
      const inserted = await sql<Selectable<WorkflowWorkArea>>`
        INSERT INTO WorkflowWorkArea (
          workAreaId, workspaceId, lineageKey, ownerRunId, layoutDigest, status, generation,
          reservedBytes, retainReason, createdAt, updatedAt
        )
        SELECT ${area.workAreaId}, ${area.workspaceId}, ${area.lineageKey}, ${area.ownerRunId}, ${area.layoutDigest},
          ${area.status}, ${area.generation}, ${area.reservedBytes}, NULL, ${area.createdAt}, ${area.updatedAt}
        WHERE (
          SELECT COUNT(*) FROM WorkflowWorkArea
          WHERE workspaceId = ${area.workspaceId} AND status IN (${sql.join(CONSUMING_STATUSES)})
        ) < ${input.countLimit}
        AND (
          SELECT COALESCE(SUM(reservedBytes), 0) FROM WorkflowWorkArea
          WHERE workspaceId = ${area.workspaceId} AND status IN (${sql.join(CONSUMING_STATUSES)})
        ) + ${area.reservedBytes} <= ${input.byteLimit}
        RETURNING *
      `.execute(trx);
      if (!inserted.rows[0]) throw new WorkflowWorkAreaError('quota_exceeded', 'Temporary work capacity is full for this workspace.');
      return inserted.rows[0];
    } catch (error) {
      const raced = await trx.selectFrom('WorkflowWorkArea').selectAll()
        .where('workspaceId', '=', input.workspaceId).where('lineageKey', '=', input.lineageKey).executeTakeFirst();
      if (raced?.ownerRunId === input.ownerRunId) return raced;
      throw error;
    }
  }

  async upsertRepository(input: {
    workAreaId: string; repoKey: string; sourceRevision: string; status: WorkflowWorkAreaRepository['status'];
    dirty?: boolean; active?: boolean; uniqueWork?: boolean; retainReason?: string | null;
  }): Promise<void> {
    const area = await this.get(input.workAreaId);
    if (!area) throw new WorkflowWorkAreaError('not_found', 'Task work area was not found.');
    const existing = await this.db.selectFrom('WorkflowWorkAreaRepository').select(['sourceRevision'])
      .where('workAreaId', '=', input.workAreaId).where('repoKey', '=', input.repoKey).executeTakeFirst();
    if (existing && existing.sourceRevision !== input.sourceRevision) {
      throw new WorkflowWorkAreaError('conflict', 'The confirmed repository revision changed for this task lineage.');
    }
    const now = this.now();
    await this.db.insertInto('WorkflowWorkAreaRepository').values({
      workAreaId: input.workAreaId, repoKey: input.repoKey, sourceRevision: input.sourceRevision,
      status: input.status, generation: area.generation, dirty: input.dirty ? 1 : 0,
      active: input.active ? 1 : 0, uniqueWork: input.uniqueWork ? 1 : 0,
      retainReason: input.retainReason ?? null, createdAt: now, updatedAt: now,
    }).onConflict((conflict) => conflict.columns(['workAreaId', 'repoKey']).doUpdateSet({
      sourceRevision: input.sourceRevision, status: input.status, generation: area.generation,
      dirty: input.dirty ? 1 : 0, active: input.active ? 1 : 0, uniqueWork: input.uniqueWork ? 1 : 0,
      retainReason: input.retainReason ?? null, updatedAt: now,
    })).execute();
  }

  async finish(workAreaId: string, operationId: string, status: 'ready' | 'blocked' | 'retained', actorId: string, message: string): Promise<void> {
    const now = this.now();
    await this.db.transaction().execute(async (trx) => {
      const area = await requireArea(trx, workAreaId);
      await trx.updateTable('WorkflowWorkArea').set({ status, retainReason: status === 'ready' ? null : message, updatedAt: now }).where('workAreaId', '=', workAreaId).execute();
      await trx.updateTable('WorkflowWorkAreaOperation').set({ status: status === 'ready' ? 'completed' : 'blocked', message, updatedAt: now }).where('operationId', '=', operationId).where('workAreaId', '=', workAreaId).execute();
      await this.audit(trx, area, operationId, actorId, `area_${status}`, message);
    });
  }

  get(workAreaId: string): Promise<Selectable<WorkflowWorkArea> | undefined> {
    return this.db.selectFrom('WorkflowWorkArea').selectAll().where('workAreaId', '=', workAreaId).executeTakeFirst();
  }

  listRepositories(workAreaId: string): Promise<Selectable<WorkflowWorkAreaRepository>[]> {
    return this.db.selectFrom('WorkflowWorkAreaRepository').selectAll().where('workAreaId', '=', workAreaId).orderBy('repoKey').execute();
  }

  private async audit(trx: Transaction<DB>, area: Selectable<WorkflowWorkArea>, operationId: string, actorId: string, eventType: string, message: string): Promise<void> {
    await trx.insertInto('WorkflowWorkAreaAuditEvent').values({
      auditId: randomUUID(), workAreaId: area.workAreaId, workspaceId: area.workspaceId,
      operationId, actorId, eventType, message, createdAt: this.now(),
    }).execute();
  }
}

export interface ProductionWorkflowWorkAreaProviderOptions {
  registry: DbWorkflowWorkAreaRegistry;
  workspaceRegistry: WorkflowWorkAreaWorkspaceRegistry;
  authorizer: WorkflowWorkAreaAuthorizer;
  worktreeDriver?: WorkflowWorktreeDriver;
  countLimit?: number;
  byteLimit?: number;
}

export class ProductionWorkflowWorkAreaProvider {
  private readonly driver: WorkflowWorktreeDriver;
  private readonly countLimit: number;
  private readonly byteLimit: number;

  constructor(private readonly options: ProductionWorkflowWorkAreaProviderOptions) {
    this.driver = options.worktreeDriver ?? new GitWorkflowWorktreeDriver();
    this.countLimit = options.countLimit ?? 8;
    this.byteLimit = options.byteLimit ?? 20 * 1024 * 1024 * 1024;
  }

  async createOrReuse(request: WorkflowWorkAreaRequest): Promise<WorkflowWorkAreaReadModel> {
    const normalized = normalizeRequest(request);
    if (!await this.options.authorizer.authorize(normalized)) throw new WorkflowWorkAreaError('not_authorized', 'This role is not authorized to use task work capacity.');
    const workspace = await this.options.workspaceRegistry.getWorkspace(normalized.workspaceId);
    if (!workspace || workspace.workspaceId !== normalized.workspaceId) throw new WorkflowWorkAreaError('not_found', 'Workspace registration was not found.');
    const repositories = selectRepositories(workspace.repositories, normalized.repoKeys, normalized.kind === 'preflight');
    await validateWorkspaceLayout(workspace);
    const canonicalWorkspaceRoot = await realpath(workspace.workspaceRoot);
    const layoutDigest = stableDigest({
      root: canonicalWorkspaceRoot,
      repositories: [...workspace.repositories]
        .sort((left, right) => left.repoKey.localeCompare(right.repoKey))
        .map((repo) => ({ key: repo.repoKey, root: resolve(repo.repositoryRoot) })),
    });
    const digest = stableDigest({ ...normalized, repoKeys: repositories.map((repo) => repo.repoKey), layoutDigest });
    const reservation = await this.options.registry.reserve({
      ...normalized, layoutDigest, requestDigest: digest, reserveBytes: normalized.reserveBytes,
      countLimit: this.countLimit, byteLimit: this.byteLimit,
    });
    // Canonicalize the server-owned root before deriving any target. This also
    // prevents a registered root symlink from redirecting task areas later.
    const managedRoot = join(canonicalWorkspaceRoot, '.workflow-workareas');
    const workAreaRoot = join(managedRoot, reservation.area.workAreaId);
    try {
      await ensureManagedDirectory(managedRoot, workspace.repositories.map((repo) => repo.repositoryRoot));
      await ensureManagedDirectory(workAreaRoot, workspace.repositories.map((repo) => repo.repositoryRoot));
      await ensureManagedDirectory(join(workAreaRoot, 'repos'), workspace.repositories.map((repo) => repo.repositoryRoot));
      let operationFailure = false;
      for (const repo of repositories) {
        try {
          await this.ensureRepository(reservation.area, repo, workAreaRoot);
        } catch (error) {
          operationFailure = true;
          const recordedRepo = (await this.options.registry.listRepositories(reservation.area.workAreaId)).find((item) => item.repoKey === repo.repoKey);
          if (!recordedRepo || recordedRepo.status === 'creating' || recordedRepo.status === 'reserved') {
            await this.options.registry.upsertRepository({
              workAreaId: reservation.area.workAreaId, repoKey: repo.repoKey,
              sourceRevision: repo.sourceRevision, status: 'retained', retainReason: safeFailure(error),
            });
          }
        }
      }
      const recorded = await this.options.registry.listRepositories(reservation.area.workAreaId);
      const retained = recorded.some((repo) => repo.status === 'retained');
      const blocked = recorded.some((repo) => repo.status === 'blocked' || repo.status === 'creating' || repo.status === 'reserved');
      const status = operationFailure || retained ? 'retained' : blocked ? 'blocked' : 'ready';
      await this.options.registry.finish(
        reservation.area.workAreaId, reservation.operationId, status, normalized.actorId,
        status === 'ready' ? 'Task work area is ready.' : 'Task work area setup needs safe recovery.',
      );
    } catch (error) {
      const message = safeFailure(error);
      await this.options.registry.finish(reservation.area.workAreaId, reservation.operationId, 'retained', normalized.actorId, message);
    }
    return this.readModel(reservation.area.workAreaId);
  }

  async reconcile(request: Omit<WorkflowWorkAreaRequest, 'kind'>): Promise<WorkflowWorkAreaReadModel> {
    return this.createOrReuse({ ...request, kind: 'reconcile' });
  }

  private async ensureRepository(area: Selectable<WorkflowWorkArea>, repo: RegisteredWorkAreaRepository, workAreaRoot: string): Promise<void> {
    const target = join(workAreaRoot, 'repos', repo.repoKey);
    assertContained(workAreaRoot, target);
    await assertNoSymlinkPath(workAreaRoot, target);
    const inspected = await this.driver.inspect({ repositoryRoot: repo.repositoryRoot, worktreeRoot: target, sourceRevision: repo.sourceRevision });
    if (inspected.exists) {
      const status = inspected.valid && !inspected.dirty && !inspected.active ? 'ready' : inspected.dirty || inspected.active || inspected.uniqueWork ? 'retained' : 'blocked';
      await this.options.registry.upsertRepository({ workAreaId: area.workAreaId, repoKey: repo.repoKey, sourceRevision: repo.sourceRevision, status, ...inspected, retainReason: status === 'ready' ? null : retentionMessage(inspected) });
      if (status !== 'ready') throw new WorkflowWorkAreaError('conflict', retentionMessage(inspected));
      return;
    }
    await this.options.registry.upsertRepository({ workAreaId: area.workAreaId, repoKey: repo.repoKey, sourceRevision: repo.sourceRevision, status: 'creating' });
    await this.driver.create({ repositoryRoot: repo.repositoryRoot, worktreeRoot: target, sourceRevision: repo.sourceRevision });
    const created = await this.driver.inspect({ repositoryRoot: repo.repositoryRoot, worktreeRoot: target, sourceRevision: repo.sourceRevision });
    if (!created.exists || !created.valid) throw new WorkflowWorkAreaError('conflict', 'Created repository work area could not be verified.');
    await this.options.registry.upsertRepository({ workAreaId: area.workAreaId, repoKey: repo.repoKey, sourceRevision: repo.sourceRevision, status: 'ready', ...created });
  }

  private async readModel(workAreaId: string): Promise<WorkflowWorkAreaReadModel> {
    const area = await this.options.registry.get(workAreaId);
    if (!area) throw new WorkflowWorkAreaError('not_found', 'Task work area was not found.');
    const repos = await this.options.registry.listRepositories(workAreaId);
    const status: WorkAreaResultStatus = area.status === 'ready' ? 'ready' : area.status === 'retained' ? 'retained' : 'blocked';
    return {
      workAreaId: area.workAreaId, workspaceId: area.workspaceId, lineageKey: area.lineageKey,
      ownerRunId: area.ownerRunId, generation: area.generation, status,
      repositories: repos.map((repo) => ({
        repoKey: safeId(repo.repoKey, 'repository'), status: repo.status === 'ready' ? 'ready' : repo.status === 'retained' ? 'retained' : 'blocked',
        dirty: Boolean(repo.dirty), active: Boolean(repo.active), uniqueWork: Boolean(repo.uniqueWork),
        message: repo.status === 'ready' ? 'Repository work area is ready.' : sanitizeGasCityProviderText(repo.retainReason ?? 'Repository work area needs recovery.', 'Repository work area needs recovery.'),
      })),
      capacity: { reservedBytes: area.reservedBytes },
      nextAction: status === 'ready' ? 'Continue the authorized task in this work area.' : 'Inspect and recover this retained task work area before retrying.',
    };
  }
}

export class GitWorkflowWorktreeDriver implements WorkflowWorktreeDriver {
  async inspect(input: { repositoryRoot: string; worktreeRoot: string; sourceRevision: string }): Promise<WorktreeInspection> {
    if (!await pathExists(input.worktreeRoot)) return { exists: false, valid: false, dirty: false, active: false, uniqueWork: false };
    try {
      const [top, head, status] = await Promise.all([
        execFile('git', ['-C', input.worktreeRoot, 'rev-parse', '--show-toplevel']),
        execFile('git', ['-C', input.worktreeRoot, 'rev-parse', 'HEAD']),
        execFile('git', ['-C', input.worktreeRoot, 'status', '--porcelain']),
      ]);
      const actualRoot = (top.stdout as string).trim();
      const actualHead = (head.stdout as string).trim();
      return { exists: true, valid: resolve(actualRoot) === resolve(input.worktreeRoot) && actualHead === input.sourceRevision, dirty: Boolean((status.stdout as string).trim()), active: false, uniqueWork: actualHead !== input.sourceRevision, sourceRevision: actualHead };
    } catch {
      return { exists: true, valid: false, dirty: false, active: false, uniqueWork: true };
    }
  }

  async create(input: { repositoryRoot: string; worktreeRoot: string; sourceRevision: string }): Promise<void> {
    await execFile('git', ['-C', input.repositoryRoot, 'worktree', 'add', '--detach', input.worktreeRoot, input.sourceRevision]);
  }
}

interface VkWorkAreaRegistryClient {
  getWorkspace(workspaceId: string): Promise<{ id: string; container_ref: string | null }>;
  getWorkspaceRepos(workspaceId: string): Promise<Array<{ id: string; target_branch: string }>>;
  listRepos(): Promise<Array<{ id: string; path: string; name: string }> >;
}

/** Resolves all physical information from VK's server-side workspace registry. */
export class VkWorkflowWorkAreaWorkspaceRegistry implements WorkflowWorkAreaWorkspaceRegistry {
  constructor(private readonly vk: VkWorkAreaRegistryClient) {}

  async getWorkspace(workspaceId: string): Promise<RegisteredWorkAreaWorkspace | null> {
    try {
      const [workspace, associations, registered] = await Promise.all([
        this.vk.getWorkspace(workspaceId), this.vk.getWorkspaceRepos(workspaceId), this.vk.listRepos(),
      ]);
      if (!workspace.container_ref || !isAbsolute(workspace.container_ref)) return null;
      const byId = new Map(registered.map((repo) => [repo.id, repo]));
      const repositories = await Promise.all(associations.map(async (association) => {
        const repo = byId.get(association.id);
        if (!repo || !isAbsolute(repo.path)) throw new WorkflowWorkAreaError('unsafe_layout', 'Workspace repository registration is incomplete.');
        const revision = (await execFile('git', ['-C', repo.path, 'rev-parse', association.target_branch])).stdout.trim();
        if (!/^[0-9a-f]{40,64}$/i.test(revision)) throw new WorkflowWorkAreaError('unsafe_layout', 'Workspace repository revision could not be verified.');
        return { repoKey: repo.id, repositoryRoot: repo.path, sourceRevision: revision };
      }));
      return { workspaceId: workspace.id, workspaceRoot: workspace.container_ref, repositories };
    } catch (error) {
      if (error instanceof WorkflowWorkAreaError) throw error;
      return null;
    }
  }
}

function normalizeRequest(request: WorkflowWorkAreaRequest): WorkflowWorkAreaRequest {
  const normalized = {
    ...request,
    workspaceId: requiredId(request.workspaceId, 'workspace'), lineageKey: requiredId(request.lineageKey, 'task lineage'),
    ownerRunId: requiredId(request.ownerRunId, 'owner run'), operationKey: requiredId(request.operationKey, 'operation'),
    actorId: requiredId(request.actorId, 'actor'), roleId: requiredId(request.roleId, 'role'),
    repoKeys: request.repoKeys?.map((key) => requiredId(key, 'repository')),
  };
  if (!Number.isSafeInteger(request.reserveBytes) || request.reserveBytes < 0) throw new WorkflowWorkAreaError('invalid_request', 'Reserved size must be a non-negative integer.');
  if (normalized.repoKeys && new Set(normalized.repoKeys).size !== normalized.repoKeys.length) throw new WorkflowWorkAreaError('invalid_request', 'Repository selection contains duplicates.');
  return normalized;
}

function selectRepositories(registered: RegisteredWorkAreaRepository[], requested: string[] | undefined, preflight: boolean): RegisteredWorkAreaRepository[] {
  const byKey = new Map(registered.map((repo) => [requiredId(repo.repoKey, 'registered repository'), repo]));
  const keys = preflight || !requested ? [...byKey.keys()].sort() : requested;
  if (keys.length === 0) throw new WorkflowWorkAreaError('invalid_request', 'At least one registered repository is required.');
  return keys.map((key) => {
    const repo = byKey.get(key);
    if (!repo) throw new WorkflowWorkAreaError('not_authorized', 'A requested repository is not registered for this workspace.');
    if (!isAbsolute(repo.repositoryRoot) || !repo.sourceRevision.trim()) throw new WorkflowWorkAreaError('unsafe_layout', 'Workspace repository registration is incomplete.');
    return repo;
  });
}

async function validateWorkspaceLayout(workspace: RegisteredWorkAreaWorkspace): Promise<void> {
  if (!isAbsolute(workspace.workspaceRoot)) throw new WorkflowWorkAreaError('unsafe_layout', 'Workspace storage registration is invalid.');
  const root = await realpath(workspace.workspaceRoot).catch(() => resolve(workspace.workspaceRoot));
  const managed = join(root, '.workflow-workareas');
  for (const repo of workspace.repositories) {
    const repoRoot = await realpath(repo.repositoryRoot).catch(() => resolve(repo.repositoryRoot));
    if (contains(repoRoot, managed)) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage must remain outside repositories.');
  }
}

async function ensureManagedDirectory(path: string, repositoryRoots: string[]): Promise<void> {
  for (const repoRoot of repositoryRoots) if (contains(resolve(repoRoot), resolve(path))) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage must remain outside repositories.');
  await assertNoSymlinkPath(dirname(path), path);
  await mkdir(path, { recursive: true });
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage could not be verified.');
}

async function assertNoSymlinkPath(root: string, target: string): Promise<void> {
  assertContained(root, target);
  let cursor = resolve(root);
  const parts = relative(cursor, resolve(target)).split(sep).filter(Boolean);
  for (const part of parts) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat?.isSymbolicLink()) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage contains an unsupported link.');
  }
}

function assertContained(root: string, target: string): void {
  if (!contains(resolve(root), resolve(target))) throw new WorkflowWorkAreaError('unsafe_layout', 'Managed task storage escaped its assigned root.');
}

function contains(root: string, target: string): boolean {
  const value = relative(root, target);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? false : Promise.reject(error));
}

function retentionMessage(state: WorktreeInspection): string {
  if (state.active) return 'Task work is active and must be retained.';
  if (state.dirty) return 'Task work contains uncommitted changes and must be retained.';
  if (state.uniqueWork) return 'Task work contains unique changes and must be retained.';
  return 'Task work state could not be verified and must be retained.';
}

function safeFailure(error: unknown): string {
  if (error instanceof WorkflowWorkAreaError) return sanitizeGasCityProviderText(error.message, 'Task work area needs recovery.');
  return 'Task work area setup did not finish. It was retained for safe recovery.';
}

function requiredId(value: string, label: string): string {
  const id = value.trim();
  if (!SAFE_ID.test(id)) throw new WorkflowWorkAreaError('invalid_request', `A valid ${label} identifier is required.`);
  return id;
}

function safeId(value: string, fallback: string): string {
  return SAFE_ID.test(value) ? value : fallback;
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function requireArea(trx: Transaction<DB>, workAreaId: string): Promise<Selectable<WorkflowWorkArea>> {
  const area = await trx.selectFrom('WorkflowWorkArea').selectAll().where('workAreaId', '=', workAreaId).executeTakeFirst();
  if (!area) throw new WorkflowWorkAreaError('not_found', 'Task work area was not found.');
  return area;
}
