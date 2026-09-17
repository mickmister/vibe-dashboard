import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileHotswapStateStore } from './hotswap-state-store.node';
import type { HotswapState } from './vk-agent-hotswap';

describe('FileHotswapStateStore', () => {
  it('writes readable state and sanitizes the state id in the filename', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vd-hotswap-state-'));
    const store = new FileHotswapStateStore(dir);
    const state = hotswapState({ id: 'weekly/dev:1' });

    await store.write(state);

    await expect(store.read('weekly/dev:1')).resolves.toMatchObject({ id: 'weekly/dev:1' });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('/');
    await expect(readFile(join(dir, files[0]!), 'utf8')).resolves.toContain('weekly/dev:1');
  });

  it('returns null for missing state and rejects corrupt state clearly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vd-hotswap-state-'));
    const store = new FileHotswapStateStore(dir);

    await expect(store.read('missing')).resolves.toBeNull();
    await writeFile(join(dir, 'bad.json'), JSON.stringify({ version: 99 }));
    await expect(store.read('bad')).rejects.toThrow('unsupported version');
  });
});

function hotswapState(overrides: Partial<HotswapState> = {}): HotswapState {
  return {
    version: 1,
    id: 'hot-1',
    targetPrograms: ['vibe-kanban'],
    status: 'captured',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    sessions: {},
    errors: [],
    ...overrides,
  };
}
