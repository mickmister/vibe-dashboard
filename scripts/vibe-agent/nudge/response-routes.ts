import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_RESPONSE_ROUTES_PATH = '/var/lib/vd/auto-nudge/response-routes.json';
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;

export type ResponseRouteStatus = 'pending' | 'delivered' | 'terminal-no-response' | 'failed';

export interface ResponseRoute {
  id: string;
  processId: string | null;
  targetRole: string;
  targetSessionId: string;
  replySessionId: string;
  createdAt: string;
  updatedAt: string;
  status: ResponseRouteStatus;
  deliveredProcessId: string | null;
  error: string | null;
}

export interface ResponseRouteState {
  version: 1;
  routes: Record<string, ResponseRoute>;
}

export function makeResponseRouteId(processId: string, replySessionId: string): string {
  return `${processId}:${replySessionId}`;
}

function responseRoutesLockPath(filePath: string): string {
  return `${filePath}.lock`;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withResponseRouteLock<T>(
  filePath: string,
  fn: () => T,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
): T {
  const lockPath = responseRoutesLockPath(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const expiresAt = Date.now() + timeoutMs;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = Number.parseInt(fs.readFileSync(path.join(lockPath, 'pid'), 'utf8'), 10);
        if (Number.isInteger(owner)) process.kill(owner, 0);
      } catch (ownerError) {
        if ((ownerError as NodeJS.ErrnoException).code === 'ESRCH' || (ownerError as NodeJS.ErrnoException).code === 'ENOENT') {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      }
      if (Date.now() >= expiresAt) throw new Error(`Timed out waiting for response-route lock ${lockPath}`);
      sleepSync(10);
    }
  }
  try { return fn(); }
  finally { fs.rmSync(lockPath, { recursive: true, force: true }); }
}

export function readResponseRouteState(filePath: string): ResponseRouteState {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, routes: {} };
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (error) {
    throw new Error(`Invalid response-route state JSON at ${filePath}: ${(error as Error).message}`);
  }
  const state = parsed as Partial<ResponseRouteState>;
  const validRoute = (route: unknown): route is ResponseRoute => Boolean(route && typeof route === 'object'
    && typeof (route as ResponseRoute).id === 'string'
    && ((route as ResponseRoute).processId == null || typeof (route as ResponseRoute).processId === 'string')
    && typeof (route as ResponseRoute).targetRole === 'string'
    && typeof (route as ResponseRoute).targetSessionId === 'string'
    && typeof (route as ResponseRoute).replySessionId === 'string'
    && typeof (route as ResponseRoute).createdAt === 'string'
    && typeof (route as ResponseRoute).updatedAt === 'string'
    && ['pending', 'delivered', 'terminal-no-response', 'failed'].includes((route as ResponseRoute).status)
    && ((route as ResponseRoute).deliveredProcessId == null || typeof (route as ResponseRoute).deliveredProcessId === 'string')
    && ((route as ResponseRoute).error == null || typeof (route as ResponseRoute).error === 'string'));
  if (state.version !== 1 || !state.routes || typeof state.routes !== 'object' || !Object.values(state.routes).every(validRoute)) {
    throw new Error(`Invalid response-route state schema at ${filePath}`);
  }
  return state as ResponseRouteState;
}

export function writeResponseRouteState(filePath: string, state: ResponseRouteState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

export function appendResponseRoute(
  filePath: string,
  route: Omit<ResponseRoute, 'id' | 'status' | 'deliveredProcessId' | 'error'>,
): ResponseRoute {
  return withResponseRouteLock(filePath, () => {
    const state = readResponseRouteState(filePath);
    const id = route.processId ? makeResponseRouteId(route.processId, route.replySessionId) : `intent:${randomUUID()}`;
    const existing = state.routes[id];
    if (existing) return existing;
    const created: ResponseRoute = { ...route, id, status: 'pending', deliveredProcessId: null, error: null };
    state.routes[id] = created;
    writeResponseRouteState(filePath, state);
    return created;
  });
}

export function snapshotPendingResponseRoutes(filePath: string): ResponseRoute[] {
  return withResponseRouteLock(filePath, () =>
    Object.values(readResponseRouteState(filePath).routes)
      .filter(route => route.status === 'pending')
      .map(route => structuredClone(route)),
  );
}

export function updateResponseRoute(
  filePath: string,
  routeId: string,
  update: (route: ResponseRoute) => ResponseRoute,
): ResponseRoute | null {
  return withResponseRouteLock(filePath, () => {
    const state = readResponseRouteState(filePath);
    const current = state.routes[routeId];
    if (!current) return null;
    const next = update(structuredClone(current));
    state.routes[routeId] = next;
    writeResponseRouteState(filePath, state);
    return next;
  });
}

export function bindResponseRouteProcess(
  filePath: string,
  routeId: string,
  processId: string,
  updatedAt: string,
): ResponseRoute | null {
  return updateResponseRoute(filePath, routeId, route => {
    if (route.status !== 'pending') return route;
    if (route.processId && route.processId !== processId) {
      return { ...route, status: 'failed', updatedAt, error: `route already bound to process ${route.processId}` };
    }
    return { ...route, processId, updatedAt, error: null };
  });
}
