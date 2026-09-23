import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_RESPONSE_ROUTES_PATH = '/var/lib/vd/auto-nudge/response-routes.json';

export type ResponseRouteStatus = 'pending' | 'delivered' | 'terminal-no-response' | 'failed';

export interface ResponseRoute {
  id: string;
  processId: string;
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
    && typeof (route as ResponseRoute).processId === 'string'
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
  const state = readResponseRouteState(filePath);
  const id = makeResponseRouteId(route.processId, route.replySessionId);
  const existing = state.routes[id];
  if (existing) return existing;
  const created: ResponseRoute = { ...route, id, status: 'pending', deliveredProcessId: null, error: null };
  state.routes[id] = created;
  writeResponseRouteState(filePath, state);
  return created;
}
