import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { callbacksForTrigger, callbacksForSession, createCallback, failCallbackStart, readCallbackRegistry, updateCallback } from './callback-registry.js';

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
      id: 'callback-1', status: 'completed', completionProcessId: 'process-1', sourceProcessId: null,
    });
  });

  it('migrates v1 records and correlates only explicit trigger processes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'callback-registry-')); dirs.push(dir); const file = join(dir, 'callbacks.json');
    writeFileSync(file, JSON.stringify({ version: 1, callbacks: [{ id: 'old', sessionId: 'session-1', command: 'ci', status: 'completed', startedAt: '2026-09-18T00:00:00.000Z', timeoutMs: null, finishedAt: null, completionProcessId: null, runnerPid: null, error: null }] }));
    expect(readCallbackRegistry(file)).toMatchObject({ version: 2, callbacks: [{ sourceProcessId: null, triggerProcessId: null }] });
    expect(callbacksForTrigger(file, 'unrelated')).toEqual([]);
  });

  it('fails closed for malformed and unsupported registry files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'callback-registry-')); dirs.push(dir); const file = join(dir, 'callbacks.json');
    writeFileSync(file, '{broken');
    expect(() => readCallbackRegistry(file)).toThrow(/Invalid callback registry JSON/);
    writeFileSync(file, JSON.stringify({ version: 99, callbacks: [] }));
    expect(() => readCallbackRegistry(file)).toThrow(/Unsupported callback registry version/);
    writeFileSync(file, JSON.stringify({ version: 2, callbacks: [{ id: 'bad' }] }));
    expect(() => readCallbackRegistry(file)).toThrow(/Invalid callback record/);
  });

  it('recovers a null-PID callback only after the grace period', () => {
    const dir = mkdtempSync(join(tmpdir(), 'callback-registry-')); dirs.push(dir); const file = join(dir, 'callbacks.json');
    createCallback(file, { id: 'pending', sessionId: 'session-1', command: 'ci', startedAt: '2026-09-18T00:00:00.000Z', sourceProcessId: 'trigger' });
    expect(callbacksForSession(file, 'session-1', new Date('2026-09-18T00:00:20.000Z'))[0]?.status).toBe('running');
    expect(callbacksForSession(file, 'session-1', new Date('2026-09-18T00:00:31.000Z'))[0]).toMatchObject({ status: 'timed-out', error: 'callback runner was never assigned a process ID' });
  });

  it('records callback spawn failure immediately', () => {
    const dir = mkdtempSync(join(tmpdir(), 'callback-registry-')); dirs.push(dir); const file = join(dir, 'callbacks.json');
    createCallback(file, { id: 'spawn', sessionId: 'session-1', command: 'ci', startedAt: '2026-09-18T00:00:00.000Z' });
    expect(failCallbackStart(file, 'spawn', new Error('ENOENT'), new Date('2026-09-18T00:00:01.000Z'))).toMatchObject({
      status: 'failed', finishedAt: '2026-09-18T00:00:01.000Z', error: 'failed to spawn callback runner: ENOENT',
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
