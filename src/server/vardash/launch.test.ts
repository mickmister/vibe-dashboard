import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EventEmitter } from 'node:events';

import {
  VardashLaunchError,
  VardashLaunchRunner,
  buildNormalAgentExecutionEnv,
  prepareVardashRepoProcessLaunch,
  resolveVardashProcessCwd,
  type VardashChildProcess,
  type VardashProcessSpawnOptions,
  type VardashProcessSpawner,
} from './launch';
import { SqlcipherVardashStore } from './store';

const stores: SqlcipherVardashStore[] = [];

afterEach(async () => {
  await Promise.all(stores.map((store) => store.close()));
  stores.length = 0;
});

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), 'vardash-launch-'));
  const store = new SqlcipherVardashStore({
    dbPath: join(root, 'private/vardash.db'),
    keyOptions: { privateDir: join(root, 'private/keys') },
  });
  stores.push(store);
  await store.migrate();
  return store;
}

describe('vardash explicit repo launch isolation', () => {
  it('builds a launch env with only baseline vars plus the selected repo env', async () => {
    const store = await createStore();
    const repoAKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const repoBKey = await store.upsertRepoEnvKey({ repoId: 'repo-b', key: 'API_TOKEN', kind: 'secret', required: true });
    const repoASecret = await store.createSavedValue({ repoId: 'repo-a', envKeyId: repoAKey.id, name: 'local', value: 'repo-a-token' });
    const repoBSecret = await store.createSavedValue({ repoId: 'repo-b', envKeyId: repoBKey.id, name: 'local', value: 'repo-b-token' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: repoAKey.id, savedValueId: repoASecret.id });
    await store.setRepoDefaultSelection({ repoId: 'repo-b', envKeyId: repoBKey.id, savedValueId: repoBSecret.id });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-b', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const plan = await prepareVardashRepoProcessLaunch({
      store,
      workspaceId: 'workspace-1',
      repoId: 'repo-a',
      repoRoot: '/workspace/repo-a',
      baseEnv: {
        PATH: '/usr/bin',
        HOME: '/home/vkuser',
        API_TOKEN: 'ambient-token-must-not-survive',
        OTHER_REPO_SECRET: 'repo-b-token',
      },
    });

    expect(plan.command).toBe('sh');
    expect(plan.args).toEqual(['-lc', 'npm run dev']);
    expect(plan.env).toEqual({ PATH: '/usr/bin', HOME: '/home/vkuser', API_TOKEN: 'repo-a-token' });
    expect(JSON.stringify(plan.env)).not.toContain('repo-b-token');
    expect(plan.process.repoId).toBe('repo-a');
    expect(plan.cwd).toBe('/workspace/repo-a');
  });

  it('does not merge vardash secrets into normal agent/session env', () => {
    const env = buildNormalAgentExecutionEnv({
      baseEnv: {
        PATH: '/usr/bin',
        HOME: '/home/vkuser',
        API_TOKEN: 'repo-secret',
        VARDASH_SECRET: 'hidden',
      },
    });

    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/vkuser' });
    expect(JSON.stringify(env)).not.toContain('repo-secret');
    expect(JSON.stringify(env)).not.toContain('hidden');
  });

  it('blocks launch when required repo env values are missing', async () => {
    const store = await createStore();
    await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    await expect(
      prepareVardashRepoProcessLaunch({ store, workspaceId: 'workspace-1', repoId: 'repo-a' }),
    ).rejects.toThrow(VardashLaunchError);
    await expect(
      prepareVardashRepoProcessLaunch({ store, workspaceId: 'workspace-1', repoId: 'repo-a' }),
    ).rejects.toThrow('Missing required vardash env values: API_TOKEN');
  });

  it('optionally wraps launch argv with Varlock without putting values in schema', async () => {
    const store = await createStore();
    const tokenKey = await store.upsertRepoEnvKey({
      repoId: 'repo-a',
      key: 'API_TOKEN',
      kind: 'secret',
      required: true,
      description: 'description-secret should not be in varlock schema',
    });
    const token = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'local', value: 'repo-a-token' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: token.id });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const plan = await prepareVardashRepoProcessLaunch({
      store,
      workspaceId: 'workspace-1',
      repoId: 'repo-a',
      repoRoot: '/workspace/repo-a',
      useVarlock: true,
      varlockSchemaPath: '/private/vardash/workspace-1/repo-a/.env.schema',
    });

    expect(plan.command).toBe('varlock');
    expect(plan.args).toEqual([
      'run',
      '--path',
      '/private/vardash/workspace-1/repo-a/.env.schema',
      '--inject',
      'vars',
      '--',
      'sh',
      '-lc',
      'npm run dev',
    ]);
    expect(plan.env.API_TOKEN).toBe('repo-a-token');
    expect(plan.varlock?.schema).toContain('API_TOKEN=');
    expect(plan.varlock?.schema).not.toContain('repo-a-token');
    expect(plan.varlock?.schema).not.toContain('description-secret');
  });
  it('executes launch plans with argv-safe spawn, isolated env, stable run id, and no log capture', async () => {
    const store = await createStore();
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const token = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'local', value: 'repo-a-token' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: token.id });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });
    const spawner = new FakeVardashSpawner();
    const runner = new VardashLaunchRunner({ spawner, idGenerator: () => 'run-1' });

    const plan = await prepareVardashRepoProcessLaunch({
      store,
      workspaceId: 'workspace-1',
      repoId: 'repo-a',
      repoRoot: '/workspace/repo-a',
      baseEnv: { PATH: '/usr/bin', API_TOKEN: 'ambient-secret', OTHER_SECRET: 'nope' },
    });
    const started = runner.launch(plan);

    expect(started).toEqual({ runId: 'run-1', status: 'running' });
    expect(runner.getStatus('run-1')).toMatchObject({ workspaceId: 'workspace-1', repoId: 'repo-a', status: 'running' });
    expect(spawner.calls).toHaveLength(1);
    expect(spawner.calls[0]).toMatchObject({
      command: 'sh',
      args: ['-lc', 'npm run dev'],
      options: { env: { PATH: '/usr/bin', API_TOKEN: 'repo-a-token' }, stdio: 'ignore' },
    });
    expect(JSON.stringify(runner.getStatus('run-1'))).not.toContain('repo-a-token');
    expect(JSON.stringify(runner.getStatus('run-1'))).not.toContain('ambient-secret');
  });

  it('defines stop behavior without restart support', async () => {
    const spawner = new FakeVardashSpawner();
    const runner = new VardashLaunchRunner({ spawner, idGenerator: () => 'run-stop' });
    runner.launch({
      workspaceId: 'workspace-1',
      repoId: 'repo-a',
      process: {
        id: 'proc-1',
        repoId: 'repo-a',
        name: 'Dev server',
        command: 'npm run dev',
        cwd: null,
        source: 'manual',
        isDefault: true,
        createdAt: 'now',
        updatedAt: 'now',
      },
      command: 'sh',
      args: ['-lc', 'npm run dev'],
      env: { PATH: '/usr/bin', API_TOKEN: 'secret' },
      cwd: '/workspace/repo-a',
      missingRequired: [],
    });

    const stopping = runner.stop('run-stop');
    expect(stopping.status).toBe('stopping');
    expect(spawner.children[0]?.killedWith).toBe('SIGTERM');
    spawner.children[0]?.emitExit(0, 'SIGTERM');
    expect(runner.getStatus('run-stop')).toMatchObject({ status: 'stopped', exitCode: 0 });
    expect('restart' in runner).toBe(false);
  });

  it('requires a repo root and keeps process cwd inside that root', () => {
    expect(resolveVardashProcessCwd('/workspace/repo-a', null)).toBe('/workspace/repo-a');
    expect(resolveVardashProcessCwd('/workspace/repo-a', 'packages/api')).toBe('/workspace/repo-a/packages/api');
    expect(resolveVardashProcessCwd('/workspace/repo-a', '/workspace/repo-a/packages/api')).toBe('/workspace/repo-a/packages/api');
    expect(() => resolveVardashProcessCwd(null, null)).toThrow('Repo root is required');
    expect(() => resolveVardashProcessCwd('/workspace/repo-a', '../repo-b')).toThrow('cwd must stay inside');
    expect(() => resolveVardashProcessCwd('/workspace/repo-a', '/tmp')).toThrow('cwd must stay inside');
  });

  it('prunes terminal runs by ttl and max-run retention', () => {
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    let nextId = 0;
    const spawner = new FakeVardashSpawner();
    const runner = new VardashLaunchRunner({
      spawner,
      idGenerator: () => `run-${nextId++}`,
      now: () => new Date(nowMs),
      terminalRunRetentionMs: 1000,
      maxTerminalRuns: 1,
    });
    const plan = {
      workspaceId: 'workspace-1',
      repoId: 'repo-a',
      process: {
        id: 'proc-1',
        repoId: 'repo-a',
        name: 'Dev server',
        command: 'npm run dev',
        cwd: null,
        source: 'manual' as const,
        isDefault: true,
        createdAt: 'now',
        updatedAt: 'now',
      },
      command: 'sh',
      args: ['-lc', 'npm run dev'],
      env: { PATH: '/usr/bin' },
      cwd: '/workspace/repo-a',
      missingRequired: [],
    };

    runner.launch(plan);
    spawner.children[0]?.emitExit(0, null);
    nowMs += 100;
    runner.launch(plan);
    spawner.children[1]?.emitExit(0, null);

    expect(() => runner.getStatus('run-0')).toThrow(VardashLaunchError);
    expect(runner.getStatus('run-1')).toMatchObject({ status: 'stopped' });

    nowMs += 1000;
    expect(() => runner.getStatus('run-1')).toThrow(VardashLaunchError);
  });

});


class FakeVardashSpawner implements VardashProcessSpawner {
  readonly calls: Array<{ command: string; args: string[]; options: VardashProcessSpawnOptions }> = [];
  readonly children: FakeVardashChildProcess[] = [];

  spawn(command: string, args: string[], options: VardashProcessSpawnOptions): VardashChildProcess {
    this.calls.push({ command, args, options });
    const child = new FakeVardashChildProcess();
    this.children.push(child);
    return child;
  }
}

class FakeVardashChildProcess extends EventEmitter implements VardashChildProcess {
  killedWith: NodeJS.Signals | undefined;

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith = signal;
    return true;
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit('exit', code, signal);
  }
}
