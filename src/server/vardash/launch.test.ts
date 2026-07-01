import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  VardashLaunchError,
  buildNormalAgentExecutionEnv,
  prepareVardashRepoProcessLaunch,
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
    const tokenKey = await store.upsertRepoEnvKey({ repoId: 'repo-a', key: 'API_TOKEN', kind: 'secret', required: true });
    const token = await store.createSavedValue({ repoId: 'repo-a', envKeyId: tokenKey.id, name: 'local', value: 'repo-a-token' });
    await store.setRepoDefaultSelection({ repoId: 'repo-a', envKeyId: tokenKey.id, savedValueId: token.id });
    await store.upsertRepoProcessDefinition({ repoId: 'repo-a', name: 'Dev server', command: 'npm run dev', isDefault: true });

    const plan = await prepareVardashRepoProcessLaunch({
      store,
      workspaceId: 'workspace-1',
      repoId: 'repo-a',
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
  });
});
