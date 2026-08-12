import { describe, expect, it, vi } from 'vitest';

import { ensureLegacyDevServerProcessDefinition, legacyDevServerProcessInput } from './process-definitions';
import type { VardashStore } from './store';

describe('legacy dev server process definitions', () => {
  it('maps legacy dev_server_script to a default repo process definition', () => {
    expect(
      legacyDevServerProcessInput({ id: 'repo-a', dev_server_script: ' npm run dev ' }),
    ).toEqual({
      repoId: 'repo-a',
      name: 'Dev server',
      command: 'npm run dev',
      source: 'legacy_dev_server_script',
      isDefault: true,
    });
  });

  it('ignores missing or blank legacy dev_server_script values', () => {
    expect(legacyDevServerProcessInput({ id: 'repo-a' })).toBeNull();
    expect(legacyDevServerProcessInput({ id: 'repo-a', dev_server_script: '   ' })).toBeNull();
  });

  it('upserts through the store when a legacy script is present', async () => {
    const store = {
      upsertRepoProcessDefinition: vi.fn(async (input) => ({
        id: 'process-1',
        repoId: input.repoId,
        name: input.name,
        command: input.command,
        cwd: null,
        source: input.source ?? 'manual',
        isDefault: input.isDefault === true,
        createdAt: 'now',
        updatedAt: 'now',
      })),
    } as unknown as VardashStore;

    await expect(
      ensureLegacyDevServerProcessDefinition({
        store,
        repo: { id: 'repo-a', dev_server_script: 'pnpm dev' },
      }),
    ).resolves.toMatchObject({
      repoId: 'repo-a',
      command: 'pnpm dev',
      source: 'legacy_dev_server_script',
      isDefault: true,
    });
    expect(store.upsertRepoProcessDefinition).toHaveBeenCalledWith({
      repoId: 'repo-a',
      name: 'Dev server',
      command: 'pnpm dev',
      source: 'legacy_dev_server_script',
      isDefault: true,
    });
  });
});
