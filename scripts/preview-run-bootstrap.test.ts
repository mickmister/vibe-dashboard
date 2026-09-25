import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBootstrapPlan,
  formatBootstrapPlan,
  parseBootstrapArgs,
  resolveBootstrapConfig,
} from './preview-run-bootstrap.ts';

describe('VD preview run bootstrap', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  async function makeRepo(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'vd-preview-bootstrap-'));
    tempRoots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      packageManager: 'pnpm@10.13.1',
      scripts: { dev: 'vite' },
    }), 'utf8');
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
    return root;
  }

  it('plans a frozen pnpm install before vite when a clean checkout has no dependency bins', async () => {
    const cwd = await makeRepo();
    const config = resolveBootstrapConfig({ cwd, argv: parseBootstrapArgs(['--print-only', '--', 'vite', '--host', '0.0.0.0']) });
    const plan = buildBootstrapPlan(config);

    expect(plan.install).toEqual({
      command: 'pnpm',
      args: ['install', '--frozen-lockfile'],
      reason: 'missing node_modules/.bin/vite',
    });
    expect(plan.run).toEqual({ command: 'vite', args: ['--host', '0.0.0.0'] });
    expect(formatBootstrapPlan(plan)).toContain('install: pnpm install --frozen-lockfile');
    expect(formatBootstrapPlan(plan)).toContain('run: vite --host 0.0.0.0');
  });

  it('skips install work on a warm checkout with current pnpm state', async () => {
    const cwd = await makeRepo();
    mkdirSync(join(cwd, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(cwd, 'node_modules/.bin/vite'), '#!/bin/sh\n', { mode: 0o755 });
    mkdirSync(join(cwd, 'node_modules'), { recursive: true });
    writeFileSync(join(cwd, 'node_modules/.modules.yaml'), 'layoutVersion: 5\n', 'utf8');

    const config = resolveBootstrapConfig({ cwd, argv: parseBootstrapArgs(['--', 'vite']) });
    const plan = buildBootstrapPlan(config);

    expect(plan.install).toBeUndefined();
    expect(formatBootstrapPlan(plan)).toContain('install: skipped');
  });

  it('treats pnpm state older than the lockfile as stale', async () => {
    const cwd = await makeRepo();
    mkdirSync(join(cwd, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(cwd, 'node_modules/.bin/vite'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(cwd, 'node_modules/.modules.yaml'), 'layoutVersion: 5\n', 'utf8');
    const oldTime = new Date('2026-01-01T00:00:00Z');
    const newTime = new Date('2026-01-02T00:00:00Z');
    utimesSync(join(cwd, 'node_modules/.modules.yaml'), oldTime, oldTime);
    utimesSync(join(cwd, 'pnpm-lock.yaml'), newTime, newTime);

    const plan = buildBootstrapPlan(resolveBootstrapConfig({ cwd, argv: parseBootstrapArgs(['--', 'vite']) }));

    expect(plan.install?.reason).toBe('pnpm lockfile is newer than node_modules/.modules.yaml');
  });

  it('documents the preview bootstrap and repo-local pending cache behavior', () => {
    const docs = [
      'README.md',
      'packages/beads-form/SKILL.md',
    ].map((path) => {
      return new URL(`../${path}`, import.meta.url);
    });
    const text = docs.map((url) => readFileSync(url, 'utf8')).join('\n');

    expect(text).toContain('pnpm install --frozen-lockfile');
    expect(text).toContain('BEADS_FORM_PENDING_CACHE_DIR');
    expect(text).toContain('.vk-mocked-sandbox/beads-form-pending-cache');
    expect(text).toContain('BEADS_FORM_PENDING_WARM_ON_STARTUP=0');
  });
});
