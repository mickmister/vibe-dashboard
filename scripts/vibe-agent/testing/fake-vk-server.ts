import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

export type FakeVkFaultKind = 'drop-after-accept' | 'delay' | 'reject' | 'disconnect' | 'never-complete' | 'missing' | 'ws-close' | 'malformed-json' | 'invalid-patch' | 'duplicate-message';
export interface FakeVkFault { id: string; operation: 'follow-up' | 'process-get' | 'session-processes-ws' | 'logs-ws'; targetId?: string; kind: FakeVkFaultKind; delayMs?: number; used?: boolean }
export interface FakeVkBarrier { id: string; operation: 'follow-up' | 'process-get'; targetId?: string; used?: boolean }
export interface FakeVkProcess { id: string; session_id: string; status: string; created_at: string; updated_at: string; completed_at: string | null; run_reason: string; dropped: boolean; conversation?: unknown[]; statusSequence?: string[] }
export interface FakeVkSession { id: string; workspace_id: string; name: string; executor: string; created_at: string; updated_at: string; processes: FakeVkProcess[] }
export interface FakeVkScenario { workspaces: Array<{ id: string }>; sessions: FakeVkSession[]; followUps?: Array<{ sessionId: string; process: FakeVkProcess }>; faults?: FakeVkFault[]; barriers?: FakeVkBarrier[] }
export interface FakeVkObservation { sequence: number; operationId: string; correlationId: string | null; type: string; method?: string; path?: string; metadata?: Record<string, string | number | boolean | null> }

function validateScenario(scenario: FakeVkScenario): void {
  const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`); };
  unique(scenario.workspaces.map(item => item.id), 'workspace id');
  unique(scenario.sessions.map(item => item.id), 'session id');
  unique(scenario.sessions.flatMap(item => item.processes.map(process => process.id)), 'process id');
  unique((scenario.faults ?? []).map(item => item.id), 'fault id');
  unique((scenario.barriers ?? []).map(item => item.id), 'barrier id');
  for (const fault of scenario.faults ?? []) {
    if (fault.kind === 'delay' && (!Number.isFinite(fault.delayMs) || fault.delayMs! < 0)) throw new Error(`fault ${fault.id} requires delayMs`);
  }
}

function response<T>(res: ServerResponse, data: T, status = 200): void {
  const body = JSON.stringify(status >= 400 ? { success: false, message: String(data) } : { success: true, data });
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(body);
}
function wsFrame(value: unknown): Buffer {
  const payload = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  throw new Error('fake VK WebSocket frame exceeds supported test size');
}

export class FakeVkServer {
  readonly journal: FakeVkObservation[] = [];
  private sequence = 0;
  private sockets = new Set<Socket>();
  private server = createServer((request, res) => void this.handleHttp(request, res));
  private processes = new Map<string, FakeVkProcess>();
  private barrierResolvers = new Map<string, () => void>();
  baseUrl = '';

  constructor(readonly scenario: FakeVkScenario) {
    validateScenario(scenario);
    scenario.sessions.flatMap(item => item.processes).forEach(item => this.processes.set(item.id, structuredClone(item)));
    this.server.on('connection', socket => { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)); });
    this.server.on('upgrade', (request, socket) => this.handleUpgrade(request, socket));
  }
  private observe(type: string, operationId: string, request?: IncomingMessage, metadata?: FakeVkObservation['metadata'], correlationId: string | null = null): void {
    this.journal.push({ sequence: ++this.sequence, operationId, correlationId, type, method: request?.method, path: request?.url, metadata });
  }
  private fault(operation: FakeVkFault['operation'], targetId?: string): FakeVkFault | undefined {
    const found = (this.scenario.faults ?? []).find(item => !item.used && item.operation === operation && (item.targetId == null || item.targetId === targetId));
    if (found) found.used = true;
    return found;
  }
  async start(): Promise<this> {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', () => resolve()); });
    const address = this.server.address(); if (!address || typeof address === 'string') throw new Error('fake VK did not bind TCP');
    this.baseUrl = `http://127.0.0.1:${address.port}`; return this;
  }
  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
  assertAllDeclarationsUsed(): void {
    const unused = (this.scenario.faults ?? []).filter(item => !item.used).map(item => item.id);
    const unusedBarriers = (this.scenario.barriers ?? []).filter(item => !item.used).map(item => item.id);
    if (unused.length || unusedBarriers.length) throw new Error(`unused fake VK declarations: ${[...unused, ...unusedBarriers].join(', ')}`);
  }
  releaseBarrier(id: string): void { const resolve = this.barrierResolvers.get(id); if (!resolve) throw new Error(`barrier ${id} is not waiting`); this.barrierResolvers.delete(id); resolve(); }
  private async waitAtBarrier(operation: FakeVkBarrier['operation'], targetId?: string): Promise<void> {
    const barrier = (this.scenario.barriers ?? []).find(item => !item.used && item.operation === operation && (item.targetId == null || item.targetId === targetId));
    if (!barrier) return; barrier.used = true;
    await new Promise<void>(resolve => this.barrierResolvers.set(barrier.id, resolve));
  }
  private async body(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  private async applyHttpFault(fault: FakeVkFault | undefined, res: ServerResponse): Promise<boolean> {
    if (!fault) return false;
    if (fault.kind === 'delay') await new Promise(resolve => setTimeout(resolve, fault.delayMs));
    if (fault.kind === 'reject') { response(res, 'scripted rejection', 503); return true; }
    if (fault.kind === 'disconnect') { res.destroy(); return true; }
    if (fault.kind === 'never-complete') return true;
    if (fault.kind === 'missing') { response(res, 'missing', 404); return true; }
    return false;
  }
  private async handleHttp(request: IncomingMessage, res: ServerResponse): Promise<void> {
    const operationId = randomUUID(); const url = new URL(request.url ?? '/', this.baseUrl);
    this.observe('request-received', operationId, request);
    if (request.method === 'GET' && url.pathname === '/api/workspaces') return response(res, this.scenario.workspaces);
    if (request.method === 'GET' && url.pathname === '/api/sessions') return response(res, this.scenario.sessions.filter(item => item.workspace_id === url.searchParams.get('workspace_id')).map(({ processes: _processes, ...session }) => session));
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (request.method === 'GET' && sessionMatch) {
      const session = this.scenario.sessions.find(item => item.id === decodeURIComponent(sessionMatch[1]));
      return session ? response(res, (({ processes: _p, ...rest }) => rest)(session)) : response(res, 'missing', 404);
    }
    const followUp = url.pathname.match(/^\/api\/sessions\/([^/]+)\/follow-up$/);
    if (request.method === 'POST' && followUp) {
      const sessionId = decodeURIComponent(followUp[1]); const requestBody = await this.body(request);
      await this.waitAtBarrier('follow-up', sessionId);
      const serializedBody = JSON.stringify(requestBody);
      const parsedBody = requestBody as { prompt?: unknown; executor_config?: { executor?: unknown } };
      this.observe('follow-up-validated', operationId, request, {
        sessionId,
        contentType: String(request.headers['content-type'] ?? ''),
        bodySha256: createHash('sha256').update(serializedBody).digest('hex'),
        promptLength: typeof parsedBody.prompt === 'string' ? parsedBody.prompt.length : -1,
        executor: typeof parsedBody.executor_config?.executor === 'string' ? parsedBody.executor_config.executor : null,
      });
      const declaration = this.scenario.followUps?.find(item => item.sessionId === sessionId && !this.processes.has(item.process.id));
      if (!declaration) return response(res, 'unexpected follow-up', 422);
      this.processes.set(declaration.process.id, structuredClone(declaration.process));
      this.scenario.sessions.find(item => item.id === sessionId)?.processes.push(structuredClone(declaration.process));
      this.observe('follow-up-accepted', operationId, request, { sessionId, processId: declaration.process.id }, declaration.process.id);
      const fault = this.fault('follow-up', sessionId);
      if (fault?.kind === 'drop-after-accept') { this.observe('response-dropped', operationId, request, {}, declaration.process.id); res.destroy(); return; }
      if (await this.applyHttpFault(fault, res)) return;
      this.observe('response-completed', operationId, request, {}, declaration.process.id); return response(res, declaration.process);
    }
    const processMatch = url.pathname.match(/^\/api\/execution-processes\/([^/]+)$/);
    if (request.method === 'GET' && processMatch) {
      const id = decodeURIComponent(processMatch[1]); this.observe('process-polled', operationId, request, { processId: id }, id);
      await this.waitAtBarrier('process-get', id);
      if (await this.applyHttpFault(this.fault('process-get', id), res)) return;
      const process = this.processes.get(id); if (!process) return response(res, 'missing', 404);
      const status = process.statusSequence?.shift(); if (status) process.status = status;
      return response(res, process);
    }
    response(res, 'unhandled route', 404);
  }
  private handleUpgrade(request: IncomingMessage, socket: Duplex): void {
    const operationId = randomUUID(); const url = new URL(request.url ?? '/', this.baseUrl);
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') { socket.destroy(); return; }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const sessionId = url.searchParams.get('session_id');
    const logs = url.pathname.match(/^\/api\/execution-processes\/([^/]+)\/normalized-logs\/ws$/);
    const operation = sessionId ? 'session-processes-ws' : 'logs-ws'; const target = sessionId ?? (logs ? decodeURIComponent(logs[1]) : undefined);
    this.observe('websocket-opened', operationId, request, { operation, targetId: target ?? null }, target ?? null);
    const fault = this.fault(operation, target);
    if (fault?.kind === 'ws-close') { socket.end(); return; }
    if (fault?.kind === 'malformed-json') { socket.write(wsFrame('{')); socket.end(); return; }
    if (fault?.kind === 'never-complete') return;
    const invalid = fault?.kind === 'invalid-patch';
    const value = sessionId
      ? this.scenario.sessions.find(item => item.id === sessionId)?.processes ?? []
      : this.processes.get(target ?? '')?.conversation ?? [];
    const patch = invalid ? [{ op: 'explode', path: '/wrong', value: true }] : [{ op: 'add', path: sessionId ? '/execution_processes' : '/entries', value: sessionId ? Object.fromEntries((value as FakeVkProcess[]).map(item => [item.id, item])) : value }];
    const message = { JsonPatch: patch }; socket.write(wsFrame(message)); this.observe('websocket-frame-sent', operationId, request, { kind: 'patch' }, target ?? null);
    if (fault?.kind === 'duplicate-message') socket.write(wsFrame(message));
    socket.write(wsFrame({ Ready: true })); this.observe('websocket-frame-sent', operationId, request, { kind: 'ready' }, target ?? null);
  }
}
