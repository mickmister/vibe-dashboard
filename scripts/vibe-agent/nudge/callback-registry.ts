import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_CALLBACK_REGISTRY_PATH = '/var/lib/vd/auto-nudge/callbacks.json';
export const CALLBACK_NULL_PID_GRACE_MS = 30_000;

export type CallbackStatus = 'running' | 'completed' | 'failed' | 'timed-out';

export interface CallbackRecord {
  id: string;
  sessionId: string;
  command: string;
  status: CallbackStatus;
  startedAt: string;
  timeoutMs: number | null;
  finishedAt: string | null;
  completionProcessId: string | null;
  runnerPid: number | null;
  sourceProcessId: string | null;
  triggerProcessId: string | null;
  error: string | null;
}

export interface CallbackRegistry {
  version: 2;
  callbacks: CallbackRecord[];
}

export function readCallbackRegistry(filePath: string): CallbackRegistry {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 2, callbacks: [] };
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error) { throw new Error(`Invalid callback registry JSON at ${filePath}: ${(error as Error).message}`); }
  if (!value || typeof value !== 'object' || !Array.isArray((value as any).callbacks)) throw new Error(`Invalid callback registry schema at ${filePath}`);
  const version = (value as any).version;
  if (version !== 1 && version !== 2) throw new Error(`Unsupported callback registry version ${String(version)} at ${filePath}`);
  const callbacks = (value as any).callbacks.map((item: any, index: number): CallbackRecord => {
    if (!item || typeof item.id !== 'string' || typeof item.sessionId !== 'string' || typeof item.command !== 'string'
      || typeof item.startedAt !== 'string' || !['running', 'completed', 'failed', 'timed-out'].includes(item.status)
      || (item.timeoutMs != null && typeof item.timeoutMs !== 'number')
      || (item.runnerPid != null && typeof item.runnerPid !== 'number')
      || (item.sourceProcessId != null && typeof item.sourceProcessId !== 'string')
      || (item.triggerProcessId != null && typeof item.triggerProcessId !== 'string')) {
      throw new Error(`Invalid callback record ${index} at ${filePath}`);
    }
    return { ...item, runnerPid: item.runnerPid ?? null, sourceProcessId: item.sourceProcessId ?? null, triggerProcessId: item.triggerProcessId ?? item.sourceProcessId ?? null };
  });
  return { version: 2, callbacks };
}

export function writeCallbackRegistry(filePath: string, registry: CallbackRegistry): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function withRegistryLock<T>(filePath: string, operation: () => T): T {
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    let descriptor: number | null = null;
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600);
      return operation();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const ageMs = (() => { try { return Date.now() - fs.statSync(lockPath).mtimeMs; } catch { return 0; } })();
      if (ageMs > 30_000) { try { fs.unlinkSync(lockPath); } catch { /* Another writer recovered it first. */ } }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    } finally {
      if (descriptor != null) {
        fs.closeSync(descriptor);
        try { fs.unlinkSync(lockPath); } catch { /* Lock cleanup is best effort after a completed atomic write. */ }
      }
    }
  }
  throw new Error(`Timed out acquiring callback registry lock: ${lockPath}`);
}

export function createCallback(
  filePath: string,
  input: Pick<CallbackRecord, 'id' | 'sessionId' | 'command' | 'startedAt'> & { timeoutMs?: number; sourceProcessId?: string | null; triggerProcessId?: string | null },
): CallbackRecord {
  return withRegistryLock(filePath, () => {
    const registry = readCallbackRegistry(filePath);
    if (registry.callbacks.some(item => item.id === input.id)) throw new Error(`Callback ${input.id} already exists`);
    const record: CallbackRecord = {
      ...input,
      timeoutMs: input.timeoutMs ?? null,
      status: 'running',
      finishedAt: null,
      completionProcessId: null,
      runnerPid: null,
      sourceProcessId: input.sourceProcessId ?? null,
      triggerProcessId: input.triggerProcessId ?? input.sourceProcessId ?? null,
      error: null,
    };
    registry.callbacks.push(record);
    writeCallbackRegistry(filePath, registry);
    return record;
  });
}

export function updateCallback(filePath: string, id: string, update: Partial<CallbackRecord>): CallbackRecord {
  return withRegistryLock(filePath, () => {
    const registry = readCallbackRegistry(filePath);
    const index = registry.callbacks.findIndex(item => item.id === id);
    if (index < 0) throw new Error(`Callback ${id} was not found`);
    const current = registry.callbacks[index];
    if (!current) throw new Error(`Callback ${id} was not found`);
    const next: CallbackRecord = { ...current, ...update, id };
    registry.callbacks[index] = next;
    writeCallbackRegistry(filePath, registry);
    return next;
  });
}

export function failCallbackStart(filePath: string, id: string, error: Error, now = new Date()): CallbackRecord {
  return updateCallback(filePath, id, { status: 'failed', finishedAt: now.toISOString(), error: `failed to spawn callback runner: ${error.message}` });
}

export function callbacksForSession(filePath: string, sessionId: string, now = new Date(), recover = true): CallbackRecord[] {
  const registry = readCallbackRegistry(filePath);
  let changed = false;
  for (const callback of registry.callbacks) {
    if (callback.status !== 'running') continue;
    let runnerDead = false;
    if (callback.runnerPid != null) {
      try { process.kill(callback.runnerPid, 0); } catch { runnerDead = true; }
    }
    const nullPidStale = callback.runnerPid == null
      && now.getTime() > new Date(callback.startedAt).getTime() + CALLBACK_NULL_PID_GRACE_MS;
    const exceededTimeout = callback.timeoutMs != null
      && now.getTime() > new Date(callback.startedAt).getTime() + callback.timeoutMs + 10_000;
    if (!runnerDead && !nullPidStale && !exceededTimeout) continue;
    callback.status = 'timed-out';
    callback.finishedAt = now.toISOString();
    callback.error = runnerDead
      ? 'callback runner exited without updating the registry'
      : nullPidStale ? 'callback runner was never assigned a process ID' : 'callback runner exceeded its timeout without updating the registry';
    changed = true;
  }
  if (changed && recover) {
    for (const callback of registry.callbacks.filter(item => item.sessionId === sessionId && item.status === 'timed-out')) {
      updateCallback(filePath, callback.id, callback);
    }
  }
  return registry.callbacks.filter(item => item.sessionId === sessionId);
}

export function callbacksForTrigger(filePath: string, processId: string, now = new Date(), recover = true): CallbackRecord[] {
  const registry = readCallbackRegistry(filePath);
  const sessionIds = [...new Set(registry.callbacks.filter(item => item.sourceProcessId === processId || item.triggerProcessId === processId).map(item => item.sessionId))];
  return sessionIds.flatMap(sessionId => callbacksForSession(filePath, sessionId, now, recover))
    .filter(item => item.sourceProcessId === processId || item.triggerProcessId === processId);
}
