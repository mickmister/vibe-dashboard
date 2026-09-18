import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_CALLBACK_REGISTRY_PATH = '/var/lib/vd/auto-nudge/callbacks.json';

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
  error: string | null;
}

export interface CallbackRegistry {
  version: 1;
  callbacks: CallbackRecord[];
}

export function readCallbackRegistry(filePath: string): CallbackRegistry {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as CallbackRegistry;
    if (value.version === 1 && Array.isArray(value.callbacks)) return value;
  } catch {
    // A missing registry means no callbacks. Corruption is surfaced by writes, which preserve the old file.
  }
  return { version: 1, callbacks: [] };
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
  input: Pick<CallbackRecord, 'id' | 'sessionId' | 'command' | 'startedAt'> & { timeoutMs?: number },
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
    const next = { ...registry.callbacks[index], ...update, id };
    registry.callbacks[index] = next;
    writeCallbackRegistry(filePath, registry);
    return next;
  });
}

export function callbacksForSession(filePath: string, sessionId: string, now = new Date()): CallbackRecord[] {
  const registry = readCallbackRegistry(filePath);
  let changed = false;
  for (const callback of registry.callbacks) {
    if (callback.status !== 'running') continue;
    let runnerDead = false;
    if (callback.runnerPid != null) {
      try { process.kill(callback.runnerPid, 0); } catch { runnerDead = true; }
    }
    const exceededTimeout = callback.timeoutMs != null
      && now.getTime() > new Date(callback.startedAt).getTime() + callback.timeoutMs + 10_000;
    if (!runnerDead && !exceededTimeout) continue;
    callback.status = 'timed-out';
    callback.finishedAt = now.toISOString();
    callback.error = runnerDead
      ? 'callback runner exited without updating the registry'
      : 'callback runner exceeded its timeout without updating the registry';
    changed = true;
  }
  if (changed) {
    for (const callback of registry.callbacks.filter(item => item.sessionId === sessionId && item.status === 'timed-out')) {
      updateCallback(filePath, callback.id, callback);
    }
  }
  return registry.callbacks.filter(item => item.sessionId === sessionId);
}
