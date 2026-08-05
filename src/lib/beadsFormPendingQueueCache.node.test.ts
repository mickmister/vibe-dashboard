import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PendingBeadsFormQueueResult } from './beadsClient.node';
import {
  BEADS_FORM_PENDING_CACHE_DIR_ENV,
  BEADS_FORM_PENDING_PARENT_DIR_ENV,
  normalizePendingQueueInput,
  pendingQueueCachePath,
  readPendingQueueDiskCache,
  shouldWarmPendingQueueOnStartup,
  writePendingQueueDiskCache,
} from './beadsFormPendingQueueCache.node';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('beadsFormPendingQueueCache.node', () => {
  it('uses ~/repos by default and allows BEADS_FORM_PENDING_PARENT_DIR override', () => {
    const defaultInput = normalizePendingQueueInput({}, {});
    expect(defaultInput.reposRoot).toMatch(/\/repos$/);
    expect(defaultInput.repoLimit).toBe(80);

    const override = normalizePendingQueueInput({}, {
      [BEADS_FORM_PENDING_PARENT_DIR_ENV]: '/tmp/all-repos',
    });
    expect(override).toEqual({ reposRoot: '/tmp/all-repos', repoLimit: 80 });
  });

  it('persists and reads stale queue data without evicting it due to age', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'beadsform-pending-cache-'));
    tempRoots.push(cacheDir);
    const env = { [BEADS_FORM_PENDING_CACHE_DIR_ENV]: cacheDir };
    const input = normalizePendingQueueInput({ reposRoot: '/tmp/repos', repoLimit: 5 }, env);
    const result = pendingQueueResult({ reposRoot: input.reposRoot, repoLimit: input.repoLimit });

    await writePendingQueueDiskCache(input, result, new Date('2026-07-31T00:00:00Z'), env);
    const cached = await readPendingQueueDiskCache(input, env);

    expect(cached).toEqual({
      result,
      loadedAtMs: Date.parse('2026-07-31T00:00:00Z'),
    });
  });

  it('keys disk cache by normalized parent dir and limit', () => {
    const env = { [BEADS_FORM_PENDING_CACHE_DIR_ENV]: '/tmp/cache' };
    const left = pendingQueueCachePath(normalizePendingQueueInput({ reposRoot: '/tmp/repos', repoLimit: 5 }, env), env);
    const right = pendingQueueCachePath(normalizePendingQueueInput({ reposRoot: '/tmp/repos', repoLimit: 6 }, env), env);

    expect(left).toMatch(/^\/tmp\/cache\/[a-f0-9]{24}\.json$/);
    expect(right).not.toBe(left);
  });

  it('warms on production startup but not Vite/dev startup unless explicitly enabled', () => {
    expect(shouldWarmPendingQueueOnStartup({ NODE_ENV: 'production' })).toBe(true);
    expect(shouldWarmPendingQueueOnStartup({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldWarmPendingQueueOnStartup({ NODE_ENV: 'development', BEADS_FORM_PENDING_WARM_ON_STARTUP: '1' })).toBe(true);
    expect(shouldWarmPendingQueueOnStartup({ NODE_ENV: 'production', BEADS_FORM_PENDING_WARM_ON_STARTUP: '0' })).toBe(false);
  });
});

function pendingQueueResult(input: { reposRoot: string; repoLimit: number }): PendingBeadsFormQueueResult {
  return {
    reposRoot: input.reposRoot,
    repoLimit: input.repoLimit,
    reposScanned: 1,
    entries: [{
      repoDir: `${input.reposRoot}/repo-a`,
      repoName: 'repo-a',
      bead: { id: 'beads-web-1', title: 'Bead' },
      form: { id: 'review', title: 'Review', responseCount: 0 },
    }],
    skipped: [],
    updateStrategy: {
      mode: 'explicit-refresh',
      rationale: 'test',
    },
  };
}
