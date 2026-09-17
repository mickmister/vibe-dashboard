import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
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
  adoptLegacyProductionWorkAreaRegistry,
  WorkflowWorkAreaError,
  classifyProcessIdentity,
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
    await designate(handle);
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
      runtimeClassification: 'production', deployment: deployment(join(root, 'server-state')),
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
    await designate(firstDb);
    const driver = new FakeDriver(); driver.createDelayMs = 80;
    const workspace = { workspaceId: 'workspace-a', workspaceRoot: root, repositories: [{ repoKey: 'web', repositoryRoot: join(root, 'source'), sourceRevision: 'abc123' }] };
    const makeProvider = (handle: VdDbHandle) => new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }),
      workspaceRegistry: { getWorkspace: async () => workspace }, authorizer: { authorize: async () => true }, worktreeDriver: driver,
      runtimeClassification: 'production', deployment: deployment(join(root, 'server-state')), minimumReservationBytes: 10, estimateReservationBytes: () => 10, byteLimit: 100, leaseTtlMs: 500, leaseWaitMs: 2_000 });
    const [first, second] = await Promise.all([makeProvider(firstDb).createOrReuse(request()), makeProvider(secondDb).createOrReuse(request())]);
    expect(first.workAreaId).toBe(second.workAreaId);
    expect(driver.create).toHaveBeenCalledTimes(1);
  });

  it('keeps filesystem mutation exclusive after DB lease expiry and latches ownership loss', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-workarea-fence-race-')); dirs.push(root);
    const source = join(root, 'source'); await mkdir(source);
    const dbPath = join(root, 'vd.sqlite');
    const firstDb = await initVdDb({ path: dbPath }); const secondDb = await initVdDb({ path: dbPath }); handles.push(firstDb, secondDb);
    await designate(firstDb);
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
      runtimeClassification: 'production', deployment: deployment(join(root, 'server-state')), minimumReservationBytes: 10, estimateReservationBytes: () => 10, byteLimit: 100, leaseTtlMs: 50, leaseWaitMs: 1_000 });
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
    const held = await new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root, currentProcessIdentity: async () => 'process-a', processIdentity: async () => 'same' })
      .acquire({ sourceIdentity: 'source-a', targetIdentity: 'target-a', holderId: 'holder-a', waitMs: 100 });
    const contender = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root, currentProcessIdentity: async () => 'process-b', processIdentity: async () => 'same' });
    await expect(contender.acquire({ sourceIdentity: 'source-a', targetIdentity: 'target-a', holderId: 'holder-b', waitMs: 40 }))
      .rejects.toMatchObject({ code: 'operation_busy' });
    const recovery = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root, currentProcessIdentity: async () => 'process-c', processIdentity: async () => 'different' });
    const recovered = await recovery.acquire({ sourceIdentity: 'source-a', targetIdentity: 'target-a', holderId: 'holder-c', waitMs: 100 });
    await held.release();
    const stillExclusive = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root, currentProcessIdentity: async () => 'process-d', processIdentity: async () => 'same' });
    await expect(stillExclusive.acquire({ sourceIdentity: 'source-a', targetIdentity: 'target-a', holderId: 'holder-d', waitMs: 40 }))
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
    await designate(firstDb);
    const driver = new FakeDriver();
    const make = (handle: VdDbHandle, repositoryRoot: string, revision: string) => new ProductionWorkflowWorkAreaProvider({
      registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }), workspaceRegistry: { getWorkspace: async () => ({ workspaceId: 'workspace-a', workspaceRoot: root, repositories: [{ repoKey: 'web', repositoryRoot, sourceRevision: revision }] }) },
      authorizer: { authorize: async () => true }, worktreeDriver: driver, minimumReservationBytes: 10, estimateReservationBytes: () => 10, byteLimit: 100,
      runtimeClassification: 'production', deployment: deployment(join(root, 'server-state')),
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
    await designate(handle);
    const real = new GitWorkflowWorktreeDriver(); let failInspection = true; let creates = 0;
    const driver: WorkflowWorktreeDriver = { resolveSource: (input) => real.resolveSource(input), create: async (input) => { creates += 1; await real.create(input); },
      inspect: async (input) => { const value = await real.inspect(input); if (value.exists && failInspection) throw new Error('crash after add'); return value; } };
    const workspace = { workspaceId: 'workspace-a', workspaceRoot: root, repositories: [{ repoKey: 'web', repositoryRoot: source, sourceRevision: revision }] };
    const provider = new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }), workspaceRegistry: { getWorkspace: async () => workspace },
      authorizer: { authorize: async () => true }, worktreeDriver: driver, runtimeClassification: 'production', deployment: deployment(join(root, 'server-state')) });
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

  it('serializes one source Git registry across workspace roots and database instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-global-fence-')); dirs.push(root);
    const source = join(root, 'source'); const state = join(root, 'server-state'); await mkdir(source);
    await mkdir(join(root, 'workspace-a')); await mkdir(join(root, 'workspace-b'));
    const firstDb = await initVdDb({ path: join(root, 'first.sqlite') }); const secondDb = await initVdDb({ path: join(root, 'second.sqlite') }); handles.push(firstDb, secondDb);
    await designate(firstDb); await designate(secondDb, 'production', 'test-production-b');
    const driver = new FakeDriver(); driver.createDelayMs = 80;
    const make = (handle: VdDbHandle, workspaceId: string, workspaceRoot: string) => new ProductionWorkflowWorkAreaProvider({
      registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }), runtimeClassification: 'production', deployment: deployment(state),
      workspaceRegistry: { getWorkspace: async () => ({ workspaceId, workspaceRoot, repositories: [{ repoKey: 'web', repositoryRoot: source, sourceRevision: 'abc123' }] }) },
      authorizer: { authorize: async () => true }, worktreeDriver: driver, minimumReservationBytes: 10, estimateReservationBytes: () => 10,
    });
    const results = await Promise.all([
      make(firstDb, 'workspace-a', join(root, 'workspace-a')).createOrReuse({ ...request(), repoKeys: ['web'] }),
      make(secondDb, 'workspace-b', join(root, 'workspace-b')).createOrReuse({ ...request(), workspaceId: 'workspace-b', lineageKey: 'task-b', ownerRunId: 'run-b', operationKey: 'op-b', repoKeys: ['web'] }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['ready', 'ready']);
    expect(driver.create).toHaveBeenCalledTimes(2);
    expect(driver.maxConcurrentCreates).toBe(1);
  });

  it('durably syncs lock transitions and leaves no resurrected claim after release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-lock-sync-')); dirs.push(root);
    const syncDirectory = vi.fn(async () => undefined);
    const manager = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root, syncDirectory,
      currentProcessIdentity: async () => 'linux:1', processIdentity: async () => 'same' });
    const lock = await manager.acquire({ sourceIdentity: 'source', targetIdentity: 'target', holderId: 'holder', waitMs: 100 });
    const lockRoot = join(await realpath(root), '.workflow-workarea-locks');
    expect((await readdir(lockRoot)).filter((name) => name.endsWith('.lock'))).toHaveLength(1);
    await lock.release();
    expect((await readdir(lockRoot)).filter((name) => name.endsWith('.lock'))).toHaveLength(0);
    expect(syncDirectory.mock.calls.length).toBeGreaterThanOrEqual(4);
    const replay = await manager.acquire({ sourceIdentity: 'source', targetIdentity: 'target', holderId: 'replay', waitMs: 100 });
    await replay.release();
  });

  it('fails closed before work starts when atomic hard links are unsupported', async () => {
    const fixture = await setup();
    const linkClaim = vi.fn(async () => { throw Object.assign(new Error('unsupported'), { code: 'EOPNOTSUPP' }); });
    const provider = new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: fixture.handle.db }),
      workspaceRegistry: fixture.workspaceRegistry, authorizer: { authorize: async () => true }, worktreeDriver: fixture.driver,
      mutationLockManager: new FilesystemWorkAreaMutationLockManager({ serverStateRoot: join(fixture.root, 'server-state-hardlink'), linkClaim }),
      runtimeClassification: 'production', deployment: deployment(join(fixture.root, 'server-state-hardlink')),
      minimumReservationBytes: 10, estimateReservationBytes: () => 80 });
    await expect(provider.createOrReuse(request())).rejects.toMatchObject({ code: 'unsafe_layout' });
    expect(fixture.driver.create).not.toHaveBeenCalled();
  });

  it('fails closed when directory synchronization is unsupported', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-lock-no-fsync-')); dirs.push(root);
    const manager = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root, syncDirectory: async () => { throw new Error('unsupported'); } });
    await expect(manager.initialize()).rejects.toMatchObject({ code: 'unsafe_layout' });
  });

  it('bounds stale forensic lock metadata and durably records cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-lock-retention-')); dirs.push(root);
    const initializer = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root });
    const initial = await initializer.acquire({ sourceIdentity: 'init', targetIdentity: 'target', holderId: 'init', waitMs: 100 });
    await initial.release();
    const lockRoot = join(await realpath(root), '.workflow-workarea-locks');
    for (let index = 0; index < 6; index += 1) await writeFile(join(lockRoot, `.claim-${index}.stale`), 'retained evidence');
    const syncDirectory = vi.fn(async () => undefined);
    const manager = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root, forensicRetentionLimit: 3, syncDirectory });
    const lock = await manager.acquire({ sourceIdentity: 'next', targetIdentity: 'target', holderId: 'next', waitMs: 100 });
    expect((await readdir(lockRoot)).filter((name) => name.endsWith('.stale'))).toHaveLength(3);
    expect(syncDirectory).toHaveBeenCalled();
    await lock.release();
  });

  it('treats same-second macOS process identity as uncertain', () => {
    expect(classifyProcessIdentity('darwin-second:Fri Sep 11 12:00:00 2026', 'darwin-second:Fri Sep 11 12:00:00 2026')).toBe('unknown');
    expect(classifyProcessIdentity('linux:123', 'linux:123')).toBe('same');
    expect(classifyProcessIdentity('darwin-second:a', 'darwin-second:b')).toBe('different');
  });

  it('requires production deployment capability and rejects registry domain drift', async () => {
    const fixture = await setup();
    expect(() => new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: fixture.handle.db }),
      workspaceRegistry: fixture.workspaceRegistry, authorizer: { authorize: async () => true }, worktreeDriver: fixture.driver, runtimeClassification: 'production',
    } as never)).toThrow(/deployment capability/i);
    await fixture.provider.createOrReuse(request());
    const mismatchedRoot = new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: fixture.handle.db }),
      workspaceRegistry: fixture.workspaceRegistry, authorizer: { authorize: async () => true }, worktreeDriver: fixture.driver,
      runtimeClassification: 'production', deployment: { mode: 'production_single_host', serverStateRoot: join(fixture.root, 'other-state'), lockDomainId: 'test-lock-domain', hostId: 'test-host' } });
    await expect(mismatchedRoot.createOrReuse({ ...request(), operationKey: 'op-mismatch-root' })).rejects.toMatchObject({ code: 'conflict' });
    const mismatchedDomain = new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: fixture.handle.db }),
      workspaceRegistry: fixture.workspaceRegistry, authorizer: { authorize: async () => true }, worktreeDriver: fixture.driver,
      runtimeClassification: 'production', deployment: { mode: 'production_single_host', serverStateRoot: join(fixture.root, 'server-state'), lockDomainId: 'other-domain', hostId: 'test-host' } });
    await expect(mismatchedDomain.createOrReuse({ ...request(), operationKey: 'op-mismatch-domain' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await fixture.handle.db.selectFrom('WorkflowWorkAreaLockDomain').selectAll().executeTakeFirst()).toMatchObject({ lockDomainId: 'test-lock-domain' });
  });

  it('supports an explicit temporary development capability without production defaults', async () => {
    const fixture = await setup({ registryKind: 'development' });
    const provider = new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: fixture.handle.db }),
      workspaceRegistry: fixture.workspaceRegistry, authorizer: { authorize: async () => true }, worktreeDriver: fixture.driver,
      runtimeClassification: 'development', deployment: { mode: 'development_temporary', unsafeDevelopmentOptIn: true, registryNamespace: 'test-dev', serverStateRoot: join(fixture.root, 'development-state') } });
    expect((await provider.createOrReuse({ ...request(), operationKey: 'development-op' })).status).toBe('ready');
  });

  it('rejects temporary capability in production and fences registry mode drift both ways', async () => {
    const fixture = await setup();
    expect(() => new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: fixture.handle.db }),
      workspaceRegistry: fixture.workspaceRegistry, authorizer: { authorize: async () => true }, worktreeDriver: fixture.driver,
      runtimeClassification: 'production', deployment: { mode: 'development_temporary', unsafeDevelopmentOptIn: true, registryNamespace: 'unsafe' } }))
      .toThrow(/not allowed in production/i);

    const freshProductionBefore = await registrySnapshot(fixture.handle);
    const developmentAgainstFreshProduction = new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: fixture.handle.db }),
      workspaceRegistry: fixture.workspaceRegistry, authorizer: { authorize: async () => true }, worktreeDriver: fixture.driver,
      runtimeClassification: 'test', deployment: { mode: 'development_temporary', unsafeDevelopmentOptIn: true,
        registryNamespace: 'fresh-drift', serverStateRoot: join(fixture.root, 'fresh-dev-drift') } });
    await expect(developmentAgainstFreshProduction.initialize()).rejects.toMatchObject({ code: 'conflict' });
    expect(await registrySnapshot(fixture.handle)).toEqual(freshProductionBefore);

    await fixture.provider.initialize();
    const productionBefore = await registrySnapshot(fixture.handle);
    const developmentAgainstProduction = new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: fixture.handle.db }),
      workspaceRegistry: fixture.workspaceRegistry, authorizer: { authorize: async () => true }, worktreeDriver: fixture.driver,
      runtimeClassification: 'test', deployment: { mode: 'development_temporary', unsafeDevelopmentOptIn: true,
        registryNamespace: 'mode-drift', serverStateRoot: join(fixture.root, 'dev-drift') } });
    await expect(developmentAgainstProduction.initialize()).rejects.toMatchObject({ code: 'conflict' });
    expect(await registrySnapshot(fixture.handle)).toEqual(productionBefore);

    const other = await setup({ registryKind: 'development' });
    const developmentFirst = new ProductionWorkflowWorkAreaProvider({ registry: new DbWorkflowWorkAreaRegistry({ db: other.handle.db }),
      workspaceRegistry: other.workspaceRegistry, authorizer: { authorize: async () => true }, worktreeDriver: other.driver,
      runtimeClassification: 'test', deployment: { mode: 'development_temporary', unsafeDevelopmentOptIn: true,
        registryNamespace: 'mode-drift', serverStateRoot: join(other.root, 'dev-first') } });
    await developmentFirst.initialize();
    const developmentBefore = await registrySnapshot(other.handle);
    await expect(other.provider.initialize()).rejects.toMatchObject({ code: 'conflict' });
    expect(await registrySnapshot(other.handle)).toEqual(developmentBefore);
  });

  it('creates one private host identity concurrently and rejects copied state on another host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-host-identity-')); dirs.push(root);
    const first = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root, runtimeHostIdentity: async () => 'host-kernel-a' });
    const second = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: root, runtimeHostIdentity: async () => 'host-kernel-a' });
    const identities = await Promise.all([first.initialize(), second.initialize()]);
    expect(identities[0].hostIdentityDigest).toBe(identities[1].hostIdentityDigest);
    const identityPath = join(root, '.workflow-workarea-host-identity');
    expect((await stat(identityPath)).mode & 0o077).toBe(0);

    const copiedRoot = await mkdtemp(join(tmpdir(), 'workflow-host-copy-')); dirs.push(copiedRoot);
    await copyFile(identityPath, join(copiedRoot, '.workflow-workarea-host-identity'));
    const copied = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: copiedRoot, runtimeHostIdentity: async () => 'host-kernel-b' });
    await expect(copied.initialize()).rejects.toMatchObject({ code: 'conflict' });
  });

  it('adopts the prior lock-domain row only when its legacy identity matches', async () => {
    const handle = await initVdDb({ path: ':memory:' }); handles.push(handle);
    await handle.db.insertInto('WorkflowWorkAreaLockDomain').values({ singletonKey: 'work-area-provider', lockDomainId: 'domain-a',
      domainDigest: 'legacy-digest', deploymentMode: null, hostIdentityDigest: null, createdAt: 1, updatedAt: 1 }).execute();
    const registry = new DbWorkflowWorkAreaRegistry({ db: handle.db });
    await registry.assertDeploymentLockDomain({ lockDomainId: 'domain-a', legacyDomainDigest: 'legacy-digest', domainDigest: 'new-digest',
      deploymentMode: 'production_single_host', hostIdentityDigest: 'private-host-digest' });
    expect(await handle.db.selectFrom('WorkflowWorkAreaLockDomain').selectAll().executeTakeFirst()).toMatchObject({
      domainDigest: 'new-digest', deploymentMode: 'production_single_host', hostIdentityDigest: 'private-host-digest',
    });
  });

  it('migrates a populated legacy production registry without data loss or untrusted startup writes', async () => {
    const handle = await initVdDb({ path: ':memory:' }); handles.push(handle);
    const root = await mkdtemp(join(tmpdir(), 'workflow-legacy-adoption-')); dirs.push(root);
    const stateRoot = join(root, 'server-state'); const manager = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: stateRoot,
      runtimeHostIdentity: async () => 'legacy-host-kernel' });
    const initialized = await manager.initialize();
    const deploymentConfig = { mode: 'production_single_host' as const, serverStateRoot: stateRoot, lockDomainId: 'legacy-domain', hostId: 'legacy-host' };
    const legacyDigest = createHash('sha256').update(JSON.stringify({ mode: deploymentConfig.mode, lockDomainId: deploymentConfig.lockDomainId,
      hostId: deploymentConfig.hostId, canonicalLockRoot: initialized.canonicalLockRoot })).digest('hex');
    await seedPopulatedLegacyRegistry(handle, legacyDigest);
    const registry = new DbWorkflowWorkAreaRegistry({ db: handle.db });
    const provider = new ProductionWorkflowWorkAreaProvider({ registry, workspaceRegistry: { getWorkspace: async () => null },
      authorizer: { authorize: async () => true }, runtimeClassification: 'production', deployment: deploymentConfig, mutationLockManager: manager });
    const before = await registrySnapshot(handle);
    await expect(provider.initialize()).rejects.toMatchObject({ code: 'conflict' });
    expect(await registrySnapshot(handle)).toEqual(before);
    const filesystemBefore = await readdir(stateRoot);
    for (const capability of ['', 'wrong-token', 'stale-token']) {
      await expect(adoptLegacyProductionWorkAreaRegistry({ registry, mutationLockManager: manager, runtimeClassification: 'production', deployment: deploymentConfig,
        registryId: 'legacy-production-registry', adoptionKey: 'unauthorized-adoption', capability,
        authorizeMaintenance: maintenanceAuthorization() })).rejects.toMatchObject({ code: 'not_authorized' });
      expect(await registrySnapshot(handle)).toEqual(before);
      expect(await readdir(stateRoot)).toEqual(filesystemBefore);
    }

    const adoption = { registry, mutationLockManager: manager, runtimeClassification: 'production' as const, deployment: deploymentConfig,
      registryId: 'legacy-production-registry', adoptionKey: 'legacy-adoption-1', capability: 'valid-token', authorizeMaintenance: maintenanceAuthorization() };
    await adoptLegacyProductionWorkAreaRegistry(adoption);
    await provider.initialize();
    expect(await handle.db.selectFrom('WorkflowWorkArea').selectAll().execute()).toEqual(before.areas);
    expect(await handle.db.selectFrom('WorkflowWorkAreaRepository').selectAll().execute()).toEqual(before.repositories);
    expect(await handle.db.selectFrom('WorkflowWorkAreaOperation').selectAll().execute()).toEqual(before.operations);
    expect(await handle.db.selectFrom('WorkflowWorkAreaOperationLease').selectAll().execute()).toEqual(before.leases);
    expect(await handle.db.selectFrom('WorkflowWorkAreaAuditEvent').selectAll().execute()).toEqual(before.audits);
    expect(await handle.db.selectFrom('WorkflowWorkAreaRegistryAdoptionAudit').selectAll().executeTakeFirst()).toMatchObject({
      adoptionKey: 'legacy-adoption-1', actorId: 'server-admin', capabilityId: 'registry-adoption', capabilityGeneration: 1,
      eventType: 'legacy_production_registry_adopted',
    });
    await adoptLegacyProductionWorkAreaRegistry(adoption);
    await expect(adoptLegacyProductionWorkAreaRegistry({ ...adoption, authorizeMaintenance: maintenanceAuthorization('other-admin') })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('allows only one exact trusted legacy adoption and never permits development adoption', async () => {
    const handle = await initVdDb({ path: ':memory:' }); handles.push(handle);
    const root = await mkdtemp(join(tmpdir(), 'workflow-adoption-race-')); dirs.push(root);
    const stateRoot = join(root, 'state'); const manager = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: stateRoot,
      runtimeHostIdentity: async () => 'race-host-kernel' });
    const initialized = await manager.initialize();
    const deploymentConfig = { mode: 'production_single_host' as const, serverStateRoot: stateRoot, lockDomainId: 'legacy-domain', hostId: 'legacy-host' };
    const legacyDigest = createHash('sha256').update(JSON.stringify({ mode: deploymentConfig.mode, lockDomainId: deploymentConfig.lockDomainId,
      hostId: deploymentConfig.hostId, canonicalLockRoot: initialized.canonicalLockRoot })).digest('hex');
    const registry = new DbWorkflowWorkAreaRegistry({ db: handle.db }); const before = await registrySnapshot(handle);
    await expect(adoptLegacyProductionWorkAreaRegistry({ registry, mutationLockManager: manager, runtimeClassification: 'production', deployment: deploymentConfig,
      registryId: 'absent-production', adoptionKey: 'absent-adoption', capability: 'valid-token', authorizeMaintenance: maintenanceAuthorization() })).rejects.toMatchObject({ code: 'conflict' });
    expect(await registrySnapshot(handle)).toEqual(before);
    await seedPopulatedLegacyRegistry(handle, legacyDigest);
    const populatedBefore = await registrySnapshot(handle);
    await expect(adoptLegacyProductionWorkAreaRegistry({ registry, mutationLockManager: manager, runtimeClassification: 'test',
      deployment: { mode: 'development_temporary', unsafeDevelopmentOptIn: true, registryNamespace: 'legacy-dev', serverStateRoot: stateRoot },
      registryId: 'bad-development', adoptionKey: 'bad-adoption', capability: 'valid-token', authorizeMaintenance: maintenanceAuthorization() })).rejects.toMatchObject({ code: 'not_authorized' });
    expect(await registrySnapshot(handle)).toEqual(populatedBefore);
    await expect(adoptLegacyProductionWorkAreaRegistry({ registry, mutationLockManager: manager, runtimeClassification: 'production',
      deployment: { ...deploymentConfig, hostId: 'wrong-host-label' }, registryId: 'wrong-production', adoptionKey: 'wrong-adoption',
      capability: 'valid-token', authorizeMaintenance: maintenanceAuthorization() }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(await registrySnapshot(handle)).toEqual(populatedBefore);

    const base = { mutationLockManager: manager, runtimeClassification: 'production' as const, deployment: deploymentConfig,
      capability: 'valid-token', authorizeMaintenance: maintenanceAuthorization() };
    const raced = await Promise.allSettled([
      adoptLegacyProductionWorkAreaRegistry({ ...base, registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }), registryId: 'production-a', adoptionKey: 'adopt-a' }),
      adoptLegacyProductionWorkAreaRegistry({ ...base, registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }), registryId: 'production-b', adoptionKey: 'adopt-b' }),
    ]);
    expect(raced.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
    expect(await handle.db.selectFrom('WorkflowWorkAreaRegistryIdentity').selectAll().execute()).toHaveLength(1);
    expect(await handle.db.selectFrom('WorkflowWorkAreaRegistryAdoptionAudit').selectAll().execute()).toHaveLength(1);
  });

  it.each([
    ['repository generation', async (handle: VdDbHandle) => { await handle.db.updateTable('WorkflowWorkAreaRepository').set({ generation: 2 }).execute(); }],
    ['lease repository', async (handle: VdDbHandle) => { await handle.db.updateTable('WorkflowWorkAreaOperationLease').set({ repoKey: 'missing' }).execute(); }],
    ['lease request digest', async (handle: VdDbHandle) => { await handle.db.updateTable('WorkflowWorkAreaOperationLease').set({ requestDigest: 'other' }).execute(); }],
    ['audit operation area', async (handle: VdDbHandle) => {
      await handle.db.insertInto('WorkflowWorkArea').values({ workAreaId: 'wa-other', workspaceId: 'workspace-b', lineageKey: 'lineage-b', ownerRunId: 'run-b',
        layoutDigest: 'layout-b', status: 'ready', generation: 1, reservedBytes: 1, retainReason: null, createdAt: 1, updatedAt: 1 }).execute();
      await handle.db.insertInto('WorkflowWorkAreaOperation').values({ operationId: 'operation-b', operationKey: 'operation-key-b', requestDigest: 'request-b',
        workAreaId: 'wa-other', actorId: 'actor-b', kind: 'preflight', status: 'completed', message: 'Ready.', createdAt: 1, updatedAt: 1 }).execute();
      await handle.db.updateTable('WorkflowWorkAreaAuditEvent').set({ operationId: 'operation-b' }).where('auditId', '=', 'audit-a').execute();
    }],
  ] as const)('rejects malformed legacy %s linkage without database or filesystem mutation', async (_label, mutate) => {
    const handle = await initVdDb({ path: ':memory:' }); handles.push(handle);
    const root = await mkdtemp(join(tmpdir(), 'workflow-malformed-adoption-')); dirs.push(root); const stateRoot = join(root, 'state');
    const manager = new FilesystemWorkAreaMutationLockManager({ serverStateRoot: stateRoot, runtimeHostIdentity: async () => 'malformed-host' });
    const initialized = await manager.initialize(); const deploymentConfig = { mode: 'production_single_host' as const,
      serverStateRoot: stateRoot, lockDomainId: 'legacy-domain', hostId: 'legacy-host' };
    const legacyDigest = createHash('sha256').update(JSON.stringify({ mode: deploymentConfig.mode, lockDomainId: deploymentConfig.lockDomainId,
      hostId: deploymentConfig.hostId, canonicalLockRoot: initialized.canonicalLockRoot })).digest('hex');
    await seedPopulatedLegacyRegistry(handle, legacyDigest); await mutate(handle);
    const before = await registrySnapshot(handle); const filesystemBefore = await readdir(stateRoot);
    await expect(adoptLegacyProductionWorkAreaRegistry({ registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }), mutationLockManager: manager,
      runtimeClassification: 'production', deployment: deploymentConfig, registryId: 'production-registry', adoptionKey: 'adoption-malformed',
      capability: 'valid-token', authorizeMaintenance: maintenanceAuthorization() })).rejects.toMatchObject({ code: 'conflict' });
    expect(await registrySnapshot(handle)).toEqual(before); expect(await readdir(stateRoot)).toEqual(filesystemBefore);
    expect(before.identity).toHaveLength(0); expect(before.adoptionAudits).toHaveLength(0);
  });
});

function request(): WorkflowWorkAreaRequest {
  return {
    workspaceId: 'workspace-a', lineageKey: 'task-a', ownerRunId: 'run-a', operationKey: 'op-a',
    actorId: 'actor-a', roleId: 'developer', mode: 'write', kind: 'preflight',
  };
}

function deployment(serverStateRoot: string) {
  return { mode: 'production_single_host' as const, serverStateRoot, lockDomainId: 'test-lock-domain', hostId: 'test-host' };
}

function maintenanceAuthorization(actorId = 'server-admin', capabilityId = 'registry-adoption', generation = 1) {
  return async ({ capability }: { capability: string }) => capability === 'valid-token' ? { actorId, capabilityId, generation } : null;
}

async function setup(options: { authorized?: boolean; countLimit?: number; byteLimit?: number; repositoriesInsideManagedRoot?: boolean; registryKind?: 'production' | 'development' } = {}) {
  const handle = await initVdDb({ path: ':memory:' });
  handles.push(handle);
  await designate(handle, options.registryKind ?? 'production', options.registryKind === 'development' ? 'test-development' : 'test-production');
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
    leaseTtlMs: 200, leaseWaitMs: 500, runtimeClassification: 'production', deployment: deployment(join(root, 'server-state')),
  });
  return { handle, root, provider, driver, workspaceRegistry };
}

async function designate(handle: VdDbHandle, kind: 'production' | 'development' = 'production', registryId = 'test-production') {
  await new DbWorkflowWorkAreaRegistry({ db: handle.db }).configureRegistryKind({ kind, registryId });
}

async function registrySnapshot(handle: VdDbHandle) {
  return {
    identity: await handle.db.selectFrom('WorkflowWorkAreaRegistryIdentity').selectAll().execute(),
    domains: await handle.db.selectFrom('WorkflowWorkAreaLockDomain').selectAll().execute(),
    areas: await handle.db.selectFrom('WorkflowWorkArea').selectAll().execute(),
    operations: await handle.db.selectFrom('WorkflowWorkAreaOperation').selectAll().execute(),
    leases: await handle.db.selectFrom('WorkflowWorkAreaOperationLease').selectAll().execute(),
    repositories: await handle.db.selectFrom('WorkflowWorkAreaRepository').selectAll().execute(),
    audits: await handle.db.selectFrom('WorkflowWorkAreaAuditEvent').selectAll().execute(),
    adoptionAudits: await handle.db.selectFrom('WorkflowWorkAreaRegistryAdoptionAudit').selectAll().execute(),
  };
}

async function seedPopulatedLegacyRegistry(handle: VdDbHandle, domainDigest: string) {
  await handle.db.insertInto('WorkflowWorkAreaLockDomain').values({ singletonKey: 'work-area-provider', lockDomainId: 'legacy-domain',
    domainDigest, deploymentMode: null, hostIdentityDigest: null, createdAt: 1, updatedAt: 1 }).execute();
  await handle.db.insertInto('WorkflowWorkArea').values({ workAreaId: 'wa-legacy', workspaceId: 'workspace-a', lineageKey: 'lineage-a', ownerRunId: 'run-a',
    layoutDigest: 'layout-digest', status: 'ready', generation: 1, reservedBytes: 100, retainReason: null, createdAt: 1, updatedAt: 1 }).execute();
  await handle.db.insertInto('WorkflowWorkAreaRepository').values({ workAreaId: 'wa-legacy', repoKey: 'web', sourceRevision: 'abc123',
    sourceIdentity: 'source-common-dir', status: 'ready', generation: 1, dirty: 0, active: 0, uniqueWork: 0, retainReason: null, createdAt: 1, updatedAt: 1 }).execute();
  await handle.db.insertInto('WorkflowWorkAreaOperation').values({ operationId: 'operation-a', operationKey: 'operation-key-a', requestDigest: 'request-digest',
    workAreaId: 'wa-legacy', actorId: 'actor-a', kind: 'preflight', status: 'completed', message: 'Ready.', createdAt: 1, updatedAt: 1 }).execute();
  await handle.db.insertInto('WorkflowWorkAreaOperationLease').values({ leaseKey: 'lease-a', workAreaId: 'wa-legacy', repoKey: 'web', operationId: 'operation-a',
    requestDigest: 'request-digest', holderId: 'holder-a', fence: 1, status: 'released', expiresAt: 1, heartbeatAt: 1, createdAt: 1, updatedAt: 1 }).execute();
  await handle.db.insertInto('WorkflowWorkAreaAuditEvent').values({ auditId: 'audit-a', workAreaId: 'wa-legacy', workspaceId: 'workspace-a',
    operationId: 'operation-a', actorId: 'actor-a', eventType: 'area_ready', message: 'Ready.', createdAt: 1 }).execute();
}

class FakeDriver implements WorkflowWorktreeDriver {
  readonly created = new Set<string>();
  readonly create = vi.fn(async (input: { worktreeRoot: string }) => {
    this.activeCreates += 1; this.maxConcurrentCreates = Math.max(this.maxConcurrentCreates, this.activeCreates);
    try {
      this.created.add(input.worktreeRoot); this.onCreate?.();
      if (this.createDelayMs) await new Promise((resolveDelay) => setTimeout(resolveDelay, this.createDelayMs));
      await mkdir(input.worktreeRoot, { recursive: true });
      if (this.swapTargetRoot) { await rm(input.worktreeRoot, { recursive: true, force: true }); await symlink(this.swapTargetRoot, input.worktreeRoot); }
      if (this.throwMessage) throw new Error(this.throwMessage);
    } finally { this.activeCreates -= 1; }
  });
  activeCreates = 0;
  maxConcurrentCreates = 0;
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
