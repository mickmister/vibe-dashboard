import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initVdDb, type VdDbHandle } from '../../../../server/database';
import {
  DbWorkflowWorkAreaRegistry,
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
    await fixture.provider.createOrReuse({ ...request(), reserveBytes: 80 });
    await expect(fixture.provider.createOrReuse({ ...request(), lineageKey: 'task-b', ownerRunId: 'run-b', operationKey: 'op-b', reserveBytes: 20 }))
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

  it('creates and verifies a real detached Git worktree under the managed root', async () => {
    const handle = await initVdDb({ path: ':memory:' });
    handles.push(handle);
    const root = await mkdtemp(join(tmpdir(), 'workflow-workarea-git-'));
    dirs.push(root);
    const repositoryRoot = join(root, 'sources', 'web');
    await mkdir(repositoryRoot, { recursive: true });
    await execFile('git', ['init', repositoryRoot]);
    await execFile('git', ['-C', repositoryRoot, 'config', 'user.email', 'workarea@example.invalid']);
    await execFile('git', ['-C', repositoryRoot, 'config', 'user.name', 'Work Area Test']);
    await execFile('git', ['-C', repositoryRoot, 'commit', '--allow-empty', '-m', 'base']);
    const revision = (await execFile('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'])).stdout.trim();
    const provider = new ProductionWorkflowWorkAreaProvider({
      registry: new DbWorkflowWorkAreaRegistry({ db: handle.db }),
      workspaceRegistry: { getWorkspace: async () => ({ workspaceId: 'workspace-a', workspaceRoot: root, repositories: [{ repoKey: 'web', repositoryRoot, sourceRevision: revision }] }) },
      authorizer: { authorize: async () => true },
    });

    const result = await provider.createOrReuse(request());
    expect(result).toMatchObject({ status: 'ready', repositories: [{ repoKey: 'web', status: 'ready' }] });
    const target = join(root, '.workflow-workareas', result.workAreaId, 'repos', 'web');
    expect((await execFile('git', ['-C', target, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(revision);
  });
});

function request(): WorkflowWorkAreaRequest {
  return {
    workspaceId: 'workspace-a', lineageKey: 'task-a', ownerRunId: 'run-a', operationKey: 'op-a',
    actorId: 'actor-a', roleId: 'developer', mode: 'write', kind: 'preflight', reserveBytes: 10,
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
  });
  return { handle, root, provider, driver, workspaceRegistry };
}

class FakeDriver implements WorkflowWorktreeDriver {
  readonly created = new Set<string>();
  readonly create = vi.fn(async (input: { repositoryRoot: string; worktreeRoot: string; sourceRevision: string }) => {
    this.created.add(input.worktreeRoot);
    if (this.throwMessage) throw new Error(this.throwMessage);
  });
  nextInspection: WorktreeInspection | null = null;
  failAfterCreate = false;
  throwMessage: string | null = null;

  get createdPaths(): string[] { return [...this.created].sort(); }

  async inspect(input: { worktreeRoot: string }): Promise<WorktreeInspection> {
    if (this.nextInspection) return this.nextInspection;
    if (!this.created.has(input.worktreeRoot)) return { exists: false, valid: false, dirty: false, active: false, uniqueWork: false };
    if (this.failAfterCreate) throw new Error('simulated restart window');
    return { exists: true, valid: true, dirty: false, active: false, uniqueWork: false };
  }
}
