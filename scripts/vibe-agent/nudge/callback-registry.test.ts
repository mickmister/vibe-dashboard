import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { callbacksForSession, createCallback, readCallbackRegistry, updateCallback } from './callback-registry.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('callback registry', () => {
  it('persists lifecycle updates atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'callback-registry-'));
    dirs.push(dir);
    const file = join(dir, 'callbacks.json');
    const record = createCallback(file, {
      id: 'callback-1', sessionId: 'session-1', command: 'npm test',
      startedAt: '2026-09-18T00:00:00.000Z', timeoutMs: 1000,
    });
    expect(record.status).toBe('running');
    updateCallback(file, record.id, {
      status: 'completed', finishedAt: '2026-09-18T00:00:01.000Z', completionProcessId: 'process-1',
    });
    expect(readCallbackRegistry(file).callbacks[0]).toMatchObject({
      id: 'callback-1', status: 'completed', completionProcessId: 'process-1',
    });
  });

  it('recovers a callback whose runner is no longer alive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'callback-registry-'));
    dirs.push(dir);
    const file = join(dir, 'callbacks.json');
    const record = createCallback(file, {
      id: 'callback-dead', sessionId: 'session-1', command: 'ci', startedAt: '2026-09-18T00:00:00.000Z',
    });
    updateCallback(file, record.id, { runnerPid: 2_147_483_647 });
    expect(callbacksForSession(file, 'session-1')[0]).toMatchObject({ status: 'timed-out', error: 'callback runner exited without updating the registry' });
  });
});
