import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initVdDb, type VdDbHandle } from '../../../../server/database';
import {
  DbWorkflowWorkAreaRegistry,
  FilesystemWorkAreaMutationLockManager,
  GitWorkflowWorktreeDriver,
  ProductionWorkflowWorkAreaProvider,
  WorkflowWorkAreaError,
  type RegisteredWorkAreaWorkspace,
  type WorkflowWorkAreaRequest,
  type WorkflowWorktreeDriver,
  type WorktreeInspection,
} from './workflowWorkAreaProvider';

const handles: VdDbHandle[] = [];
const dirs: string[] = [];
const execFile = promisify(execFileCallback);

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.db.destroy();
    handle.sqlite.close();
  }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('ProductionWorkflowWorkAreaProvider', () => {
  it('preflights registered repositories in deterministic server-owned paths and reuses the lineage', async () => {
    const fixture = await setup();
    const result = await fixture.provider.createOrReuse(request());

    expect(result).toMatchObject({ status: 'ready', workspaceId: 'workspace-a', lineageKey: 'task-a', generation: 1 });
    expect(result.capacity).toEqual({ estimatedReservedBytes: 80, accounting: 'estimated_reservation' });
    expect(result.repositories.map((repo) => repo.repoKey)).toEqual(['api', 'web']);
    expect(fixture.driver.create).toHaveBeenCalledTimes(2);
    const canonicalRoot = await realpath(fixture.root);
    expect(fixture.driver.createdPaths).toEqual([
      join(canonicalRoot, '.workflow-workareas', result.workAreaId, 'repos', 'api'),
      join(canonicalRoot, '.workflow-workareas', result.workAreaId, 'repos', 'web'),
    ]);
    expect(JSON.stringify(result)).not.toContain(fixture.root);
    expect(await fixture.handle.db.selectFrom('WorkflowWorkAreaOperation').selectAll().execute()).toHaveLength(1);
    expect(await fixture.handle.db.selectFrom('WorkflowWorkAreaAuditEvent').selectAll().execute()).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorId: 'actor-a', eventType: 'area_reserved' }),
      expect.objectContaining({ actorId: 'actor-a', eventType: 'area_ready' }),
    ]));

    const replay = await fixture.provider.createOrReuse(request());
    expect(replay.workAreaId).toBe(result.workAreaId);
    expect(fixture.driver.create).toHaveBeenCalledTimes(2);
  });

  it('rejects operation-key identity conflicts and unregistered repositories', async () => {
    const fixture = await setup();
    await fixture.provider.createOrReuse(request());
    await expect(fixture.provider.createOrReuse({ ...request(), repoKeys: ['web'], kind: 'create_or_reuse' }))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(fixture.provider.createOrReuse({ ...request(), operationKey: 'op-b', repoKeys: ['external'], kind: 'create_or_reuse' }))
      .rejects.toMatchObject({ code: 'not_authorized' });
  });

  it('enforces role authorization before resolving work-area storage', async () => {
    const fixture = await setup({ authorized: false });
    await expect(fixture.provider.createOrReuse(request())).rejects.toMatchObject({ code: 'not_authorized' });
    expect(fixture.workspaceRegistry.getWorkspace).not.toHaveBeenCalled();
  });

  it('retains dirty, active, or unique work instead of replacing it', async () => {
    const fixture = await setup();
    fixture.driver.nextInspection = { exists: true, valid: true, dirty: true, active: false, uniqueWork: true };
    const result = await fixture.provider.createOrReuse(request());
    expect(result.status).toBe('retained');
    expect(result.repositories[0]).toMatchObject({ status: 'retained', dirty: true, uniqueWork: true });
    expect(fixture.driver.create).not.toHaveBeenCalled();
  });

  it('reconciles a crash after worktree creation without creating a duplicate', async () => {
    const fixture = await setup();
    fixture.driver.failAfterCreate = true;
    const first = await fixture.provider.createOrReuse(request());
    expect(first.status).toBe('retained');
    expect(fixture.driver.create).toHaveBeenCalledTimes(2);
    const firstCreatedPath = fixture.driver.createdPaths[0];

    fixture.driver.failAfterCreate = false;
    const { kind: _kind, ...reconcileRequest } = request();
    const recovered = await fixture.provider.reconcile({ ...reconcileRequest, operationKey: 'op-reconcile' });
    expect(recovered.status).toBe('ready');
    expect(recovered.workAreaId).toBe(first.workAreaId);
    expect(fixture.driver.create).toHaveBeenCalledTimes(2);
    expect(fixture.driver.create.mock.calls.filter(([input]) => input.worktreeRoot === firstCreatedPath)).toHaveLength(1);
  });

  it('reserves count and disk quota atomically and keeps retained areas consuming capacity', async () => {
    const fixture = await setup({ countLimit: 1, byteLimit: 100 });
    await fixture.provider.createOrReuse(request());
    await expect(fixture.provider.createOrReuse({ ...request(), lineageKey: 'task-b', ownerRunId: 'run-b', operationKey: 'op-b' }))
      .rejects.toMatchObject({ code: 'quota_exceeded' });

    const concurrencyFixture = await setup({ countLimit: 1, byteLimit: 100 });
    const same = await Promise.all([
      concurrencyFixture.provider.createOrReuse(request()),
      concurrencyFixture.provider.createOrReuse(request()),
    ]);
    expect(new Set(same.map((item) => item.workAreaId)).size).toBe(1);

    const raceFixture = await setup({ countLimit: 1, byteLimit: 100 });
    const raced = await Promise.allSettled([
      raceFixture.provider.createOrReuse(request()),
      raceFixture.provider.createOrReuse({ ...request(), lineageKey: 'task-b', ownerRunId: 'run-b', operationKey: 'op-b' }),
    ]);
    expect(raced.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((entry) => entry.status === 'rejected').map((entry) => (entry as PromiseRejectedResult).reason.code)).toEqual(['quota_exceeded']);
  });

  it('blocks a managed root inside a registered repository and rejects symlinked task parents', async () => {
    const inside = await setup({ repositoriesInsideManagedRoot: true });
    await expect(inside.provider.createOrReuse(request())).rejects.toMatchObject({ code: 'unsafe_layout' });

    const fixture = await setup();
    const elsewhere = await mkdtemp(join(tmpdir(), 'work-area-link-'));
    dirs.push(elsewhere);
    await symlink(elsewhere, join(fixture.root, '.workflow-workareas'));
    const result = await fixture.provider.createOrReuse(request());
    expect(result.status).toBe('retained');
    expect(result.nextAction).not.toMatch(/\/tmp|provider|git|shell|stdout|stderr/i);
  });

  it('does not leak hostile driver diagnostics or host paths in normal output', async () => {
    const fixture = await setup();
    fixture.driver.throwMessage = `/Users/person/repo: git worktree failed; stdout queue webhook provider diagnostics`;
    const result = await fixture.provider.createOrReuse(request());
    expect(result.status).toBe('retained');
    expect(JSON.stringify(result)).not.toMatch(/\/Users|git worktree|stdout|queue|webhook|provider diagnostics/i);
  });

  it('creates and verifies real multi-repository detached Git worktrees under one managed area', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    handles.push(handle);
    const root = await mkdtemp(join(tmpdir(), 'workflow-workarea-git-'));
    dirs.push(root);
    const repositoryRoot = join(root, 'sources', 'web');
    const apiRoot = join(root, 'sources', 'api');
    const revision = await createGitRepository(repositoryRoot);
    const apiRevision = await createGitRepository(apiRoot);
    const provider = new ProductionWorkflowWorkAreaProvider({
      registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }),
      workspaceRegistry: { getWorkspace: async () => ({ workspaceId: 'workspace-a', workspaceRoot: root, repositories: [
        { repoKey: 'web', repositoryRoot, sourceRevision: revision }, { repoKey: 'api', repositoryRoot: apiRoot, sourceRevision: apiRevision },
      ] }) },
      authorizer: { authorize: async () => true },
    });

    const result = await provider.createOrReuse(request());
    expect(result.status).toBe('ready');
    expect(result.repositories).toEqual(expect.arrayContaining([{ repoKey: 'web', status: 'ready', dirty: false, active: false, uniqueWork: false, message: 'Repository work area is ready.' },
      { repoKey: 'api', status: 'ready', dirty: false, active: false, uniqueWork: false, message: 'Repository work area is ready.' }]));
    const target = join(root, '.workflow-workareas', result.workAreaId, 'repos', 'web');
    expect((await execFile('git', ['-C', target, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(revision);
    expect((await execFile('git', ['-C', join(root, '.workflow-workareas', result.workAreaId, 'repos', 'api'), 'rev-parse', 'HEAD'])).stdout.trim()).toBe(apiRevision);
  });

  it('rejects path traversal in requested and registered repository keys', async () => {
    const fixture = await setup();
    await expect(fixture.provider.createOrReuse({ ...request(), repoKeys: ['../web'], kind: 'create_or_reuse' }))
      .rejects.toMatchObject({ code: 'invalid_request' });
    fixture.workspaceRegistry.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-a', workspaceRoot: fixture.root,
      repositories: [{ repoKey: '../escape', repositoryRoot: join(fixture.root, 'sources', 'web'), sourceRevision: 'abc123' }] });
    await expect(fixture.provider.createOrReuse({ ...request(), operationKey: 'op-unsafe' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('rejects a changed repository revision or canonical registration for an existing lineage', async () => {
    const fixture = await setup();
    await fixture.provider.createOrReuse(request());
    const original = await fixture.workspaceRegistry.getWorkspace.mock.results[0]!.value;
    fixture.workspaceRegistry.getWorkspace.mockResolvedValue({ ...original,
      repositories: original.repositories.map((repo: RegisteredWorkAreaWorkspace['repositories'][number]) => repo.repoKey === 'web' ? { ...repo, sourceRevision: 'changed' } : repo) });
    await expect(fixture.provider.createOrReuse({ ...request(), operationKey: 'op-revision' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('retains the area when a source revision changes after reservation but before Git creation', async () => {
    const fixture = await setup();
    fixture.driver.changeRevisionAfterFirstResolve = true;
    const result = await fixture.provider.createOrReuse(request());
    expect(result.status).toBe('retained');
    expect(fixture.driver.create).not.toHaveBeenCalled();
  });

  it('serializes Git creation across provider and database instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-workarea-race-')); dirs.push(root);
    await mkdir(join(root, 'source'), { recursive: true });
    const dbPath = join(root, 'vd.sqlite');
    const firstDb = await initVdDb({ path: dbPath }); const secondDb = await initVdDb({ path: dbPath }); handles.push(firstDb, secondDb);
    const driver = new FakeDriver(); driver.createDelayMs = 80;
    const workspace = { workspaceId: 'workspace-a', workspaceRoot: root, repositories: [{ repoKey: 'web', repositoryRoot: join(root, 'source'), sourceRevision: 'abc123' }] };
    const makeProvider = (handle: VdDbHandle) => new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }),
      workspaceRegistry: { getWorkspace: async () => workspace }, authorizer: { authorize: async () => true }, worktreeDriver: driver,
      minimumReservationBytes: 10, estimateReservationBytes: () => 10, byteLimit: 100, leaseTtlMs: 500, leaseWaitMs: 2_000 });
    const [first, second] = await Promise.all([makeProvider(firstDb).createOrReuse(request()), makeProvider(secondDb).createOrReuse(request())]);
    expect(first.workAreaId).toBe(second.workAreaId);
    expect(driver.create).toHaveBeenCalledTimes(1);
  });

  it('keeps filesystem mutation exclusive after DB lease expiry and latches ownership loss', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-workarea-fence-race-')); dirs.push(root);
    const source = join(root, 'source'); await mkdir(source);
    const dbPath = join(root, 'vd.sqlite');
    const firstDb = await initVdDb({ path: dbPath }); const secondDb = await initVdDb({ path: dbPath }); handles.push(firstDb, secondDb);
    let loseFirstLease = false;
    class LosingRegistry extends DbWorkflowWorkAreaRegistry {
      override heartbeatLease(key: string, holder: string, fence: number, ttl: number) {
        return loseFirstLease ? Promise.resolve(false) : super.heartbeatLease(key, holder, fence, ttl);
      }
    }
    const driver = new FakeDriver(); driver.createDelayMs = 180; driver.onCreate = () => { loseFirstLease = true; };
    const workspace = { workspaceId: 'workspace-a', workspaceRoot: root, repositories: [{ repoKey: 'web', repositoryRoot: source, sourceRevision: 'abc123' }] };
    const make = (registry: DbWorkflowWorkAreaRegistry) => new ProductionWorkflowWorkAreaProvider({ registry,
      workspaceRegistry: { getWorkspace: async () => workspace }, authorizer: { authorize: async () => true }, worktreeDriver: driver,
      minimumReservationBytes: 10, estimateReservationBytes: () => 10, byteLimit: 100, leaseTtlMs: 50, leaseWaitMs: 1_000 });
    const firstPromise = make(new LosingRegistry({ db: firstDb.db })).createOrReuse(request());
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 90));
    const secondPromise = make(new DbWorkflowWorkAreaRegistry({ db: secondDb.db })).createOrReuse({ ...request(), operationKey: 'op-new-fence' });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(driver.create).toHaveBeenCalledTimes(1);
    expect(first.status).toBe('retained');
    expect(second.status).toBe('ready');
    expect((await secondDb.db.selectFrom('WorkflowWorkAreaOperationLease').selectAll().executeTakeFirstOrThrow()).fence).toBeGreaterThan(1);
  });

  it('never steals a live filesystem lock by age and recovers only a proven-dead owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-fs-lock-')); dirs.push(root);
    const held = await new FilesystemWorkAreaMutationLockManager({ currentProcessIdentity: async () => 'process-a', processIdentity: async () => 'same' })
      .acquire({ managedRoot: root, sourceIdentity: 'source-a', targetIdentity: 'target-a', holderId: 'holder-a', waitMs: 100 });
    const contender = new FilesystemWorkAreaMutationLockManager({ currentProcessIdentity: async () => 'process-b', processIdentity: async () => 'same' });
    await expect(contender.acquire({ managedRoot: root, sourceIdentity: 'source-a', targetIdentity: 'target-a', holderId: 'holder-b', waitMs: 40 }))
      .rejects.toMatchObject({ code: 'operation_busy' });
    const recovery = new FilesystemWorkAreaMutationLockManager({ currentProcessIdentity: async () => 'process-c', processIdentity: async () => 'different' });
    const recovered = await recovery.acquire({ managedRoot: root, sourceIdentity: 'source-a', targetIdentity: 'target-a', holderId: 'holder-c', waitMs: 100 });
    await held.release();
    const stillExclusive = new FilesystemWorkAreaMutationLockManager({ currentProcessIdentity: async () => 'process-d', processIdentity: async () => 'same' });
    await expect(stillExclusive.acquire({ managedRoot: root, sourceIdentity: 'source-a', targetIdentity: 'target-a', holderId: 'holder-d', waitMs: 40 }))
      .rejects.toMatchObject({ code: 'operation_busy' });
    await recovered.release();
  });

  it('heartbeats operation leases and fences stale owners on takeover', async () => {
    let now = 1_000;
    const fixture = await setup();
    const first = await fixture.provider.createOrReuse(request());
    const operation = (await fixture.handle.db.selectFrom('WorkflowWorkAreaOperation').selectAll().executeTakeFirst())!;
    const registry = new DbWorkflowWorkAreaRegistry({ db: fixture.handle.db, now: () => now });
    const base = { leaseKey: `${first.workAreaId}:lease-test`, workAreaId: first.workAreaId, repoKey: 'web', operationId: operation.operationId, requestDigest: 'digest', ttlMs: 50 };
    const ownerA = await registry.claimLease({ ...base, holderId: 'owner-a' });
    expect(ownerA).toMatchObject({ acquired: true, fence: 1 });
    expect(await registry.claimLease({ ...base, holderId: 'owner-b' })).toMatchObject({ acquired: false, fence: 1 });
    now += 51;
    const ownerB = await registry.claimLease({ ...base, holderId: 'owner-b' });
    expect(ownerB).toMatchObject({ acquired: true, fence: 2 });
    expect(await registry.heartbeatLease(base.leaseKey, 'owner-a', 1, 50)).toBe(false);
    expect(await registry.heartbeatLease(base.leaseKey, 'owner-b', 2, 50)).toBe(true);
  });

  it('allows only one immutable workspace registration to win a concurrent lineage reservation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-layout-race-')); dirs.push(root);
    const sourceA = join(root, 'source-a'); const sourceB = join(root, 'source-b'); await mkdir(sourceA); await mkdir(sourceB);
    const dbPath = join(root, 'vd.sqlite'); const firstDb = await initVdDb({ path: dbPath }); const secondDb = await initVdDb({ path: dbPath }); handles.push(firstDb, secondDb);
    const driver = new FakeDriver();
    const make = (handle: VdDbHandle, repositoryRoot: string, revision: string) => new ProductionWorkflowWorkAreaProvider({
      registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }), workspaceRegistry: { getWorkspace: async () => ({ workspaceId: 'workspace-a', workspaceRoot: root, repositories: [{ repoKey: 'web', repositoryRoot, sourceRevision: revision }] }) },
      authorizer: { authorize: async () => true }, worktreeDriver: driver, minimumReservationBytes: 10, estimateReservationBytes: () => 10, byteLimit: 100,
    });
    const results = await Promise.allSettled([make(firstDb, sourceA, 'aaa').createOrReuse(request()), make(secondDb, sourceB, 'bbb').createOrReuse(request())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected').map((result) => (result as PromiseRejectedResult).reason.code)).toEqual(['conflict']);
  });

  it('rejects an unrelated checkout with the same object id as authorized work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-workarea-owner-')); dirs.push(root);
    const source = join(root, 'source'); await createGitRepository(source);
    const unrelated = join(root, 'unrelated'); await execFile('git', ['clone', '--quiet', source, unrelated]);
    const driver = new GitWorkflowWorktreeDriver(); const revision = (await execFile('git', ['-C', source, 'rev-parse', 'HEAD'])).stdout.trim();
    const identity = await driver.resolveSource({ repositoryRoot: source, sourceRevision: revision });
    const inspection = await driver.inspect({ source: identity, worktreeRoot: unrelated });
    expect(inspection).toMatchObject({ exists: true, valid: false });
  });

  it('reconciles a real crash after git worktree add before the repository ledger update', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-workarea-crash-')); dirs.push(root);
    const source = join(root, 'source'); const revision = await createGitRepository(source);
    const handle = await initVdDb({ path: ':memory:' }); handles.push(handle);
    const real = new GitWorkflowWorktreeDriver(); let failInspection = true; let creates = 0;
    const driver: WorkflowWorktreeDriver = { resolveSource: (input) => real.resolveSource(input), create: async (input) => { creates += 1; await real.create(input); },
      inspect: async (input) => { const value = await real.inspect(input); if (value.exists && failInspection) throw new Error('crash after add'); return value; } };
    const workspace = { workspaceId: 'workspace-a', workspaceRoot: root, repositories: [{ repoKey: 'web', repositoryRoot: source, sourceRevision: revision }] };
    const provider = new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }), workspaceRegistry: { getWorkspace: async () => workspace },
      authorizer: { authorize: async () => true }, worktreeDriver: driver });
    expect((await provider.createOrReuse(request())).status).toBe('retained'); failInspection = false;
    const { kind: _kind, ...rest } = request();
    expect((await provider.reconcile({ ...rest, operationKey: 'op-recover' })).status).toBe('ready');
    expect(creates).toBe(1);
  });

  it('retains a post-create symlink swap outside the private managed root', async () => {
    const fixture = await setup(); const outside = await mkdtemp(join(tmpdir(), 'workflow-workarea-swap-')); dirs.push(outside);
    fixture.driver.swapTargetRoot = outside;
    const result = await fixture.provider.createOrReuse(request());
    expect(result.status).toBe('retained');
    expect(JSON.stringify(result)).not.toContain(outside);
  });
});

function request(): WorkflowWorkAreaRequest {
  return {
    workspaceId: 'workspace-a', lineageKey: 'task-a', ownerRunId: 'run-a', operationKey: 'op-a',
    actorId: 'actor-a', roleId: 'developer', mode: 'write', kind: 'preflight',
  };
}

async function setup(options: { authorized?: boolean; countLimit?: number; byteLimit?: number; repositoriesInsideManagedRoot?: boolean } = {}) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  const root = await mkdtemp(join(tmpdir(), 'workflow-workspace-'));
  dirs.push(root);
  await mkdir(join(root, 'sources', 'web'), { recursive: true });
  await mkdir(join(root, 'sources', 'api'), { recursive: true });
  const repositories = options.repositoriesInsideManagedRoot
    ? [{ repoKey: 'web', repositoryRoot: root, sourceRevision: 'abc123' }]
    : [
      { repoKey: 'web', repositoryRoot: join(root, 'sources', 'web'), sourceRevision: 'abc123' },
      { repoKey: 'api', repositoryRoot: join(root, 'sources', 'api'), sourceRevision: 'def456' },
    ];
  const workspace: RegisteredWorkAreaWorkspace = { workspaceId: 'workspace-a', workspaceRoot: root, repositories };
  const workspaceRegistry = { getWorkspace: vi.fn(async () => workspace) };
  const driver = new FakeDriver();
  const provider = new ProductionWorkflowWorkAreaProvider({
    registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }), workspaceRegistry,
    authorizer: { authorize: vi.fn(async () => options.authorized !== false) }, worktreeDriver: driver,
    countLimit: options.countLimit ?? 4, byteLimit: options.byteLimit ?? 1_000,
    minimumReservationBytes: 10, estimateReservationBytes: () => 80,
    leaseTtlMs: 200, leaseWaitMs: 500,
  });
  return { handle, root, provider, driver, workspaceRegistry };
}

class FakeDriver implements WorkflowWorktreeDriver {
  readonly created = new Set<string>();
  readonly create = vi.fn(async (input: { worktreeRoot: string }) => {
    this.created.add(input.worktreeRoot);
    this.onCreate?.();
    if (this.createDelayMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, this.createDelayMs));
    await mkdir(input.worktreeRoot, { recursive: true });
    if (this.swapTargetRoot) { await rm(input.worktreeRoot, { recursive: true, force: true }); await symlink(this.swapTargetRoot, input.worktreeRoot); }
    if (this.throwMessage) throw new Error(this.throwMessage);
  });
  nextInspection: WorktreeInspection | null = null;
  failAfterCreate = false;
  throwMessage: string | null = null;
  createDelayMs = 0;
  swapTargetRoot: string | null = null;
  onCreate: (() => void) | null = null;
  changeRevisionAfterFirstResolve = false;
  private readonly resolveCounts = new Map<string, number>();

  get createdPaths(): string[] { return [...this.created].sort(); }

  async resolveSource(input: { repositoryRoot: string; sourceRevision: string }) {
    const count = (this.resolveCounts.get(input.repositoryRoot) ?? 0) + 1;
    this.resolveCounts.set(input.repositoryRoot, count);
    return { canonicalRepositoryRoot: input.repositoryRoot, commonDirIdentity: `${input.repositoryRoot}/.git`,
      sourceRevision: this.changeRevisionAfterFirstResolve && count > 1 ? `${input.sourceRevision}-changed` : input.sourceRevision };
  }

  async inspect(input: { worktreeRoot: string }): Promise<WorktreeInspection> {
    if (this.nextInspection) { await mkdir(input.worktreeRoot, { recursive: true }); return this.nextInspection; }
    if (!this.created.has(input.worktreeRoot)) return { exists: false, valid: false, dirty: false, active: false, uniqueWork: false };
    if (this.failAfterCreate) throw new Error('simulated restart window');
    return { exists: true, valid: true, dirty: false, active: false, uniqueWork: false };
  }
}

async function createGitRepository(repositoryRoot: string): Promise<string> {
  await mkdir(repositoryRoot, { recursive: true });
  await execFile('git', ['init', repositoryRoot]);
  await execFile('git', ['-C', repositoryRoot, 'config', 'user.email', 'workarea@example.invalid']);
  await execFile('git', ['-C', repositoryRoot, 'config', 'user.name', 'Work Area Test']);
  await execFile('git', ['-C', repositoryRoot, 'commit', '--allow-empty', '-m', 'base']);
  return (await execFile('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'])).stdout.trim();
}
