import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VibeClient } from './client.js';

type Listener = (event: any) => void;
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  listeners = new Map<string, Listener[]>();
  constructor(_url: string) { FakeWebSocket.instances.push(this); }
  addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  emit(type: string, event: any = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  close() { this.emit('close'); }
}

describe('VibeClient.fetchConversation lifecycle', () => {
  const original = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;
  beforeEach(() => { FakeWebSocket.instances = []; globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket; });
  afterEach(() => { globalThis.WebSocket = original; globalThis.fetch = originalFetch; vi.restoreAllMocks(); vi.useRealTimers(); });

  it('returns the normalized snapshot on Ready', async () => {
    const waiting = new VibeClient().fetchConversation('process', 1_000);
    FakeWebSocket.instances[0]!.emit('message', { data: JSON.stringify({ JsonPatch: [{ op: 'add', path: '/entries', value: [{ content: { entry_type: { type: 'assistant_message' }, content: 'DONE' } }] }] }) });
    FakeWebSocket.instances[0]!.emit('message', { data: JSON.stringify({ Ready: true }) });
    await expect(waiting).resolves.toHaveLength(1);
  });

  it('rejects an already-aborted request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(new VibeClient().fetchConversation('process', 1_000, controller.signal)).rejects.toThrow(/Cancelled/);
  });

  it('aborts an in-flight request and settles only once when close follows', async () => {
    const controller = new AbortController();
    const waiting = new VibeClient().fetchConversation('process', 1_000, controller.signal);
    controller.abort();
    FakeWebSocket.instances[0]!.emit('close');
    await expect(waiting).rejects.toThrow(/Cancelled/);
  });

  it('times out and ignores a later close', async () => {
    vi.useFakeTimers();
    const waiting = new VibeClient().fetchConversation('process', 25);
    const assertion = expect(waiting).rejects.toThrow(/Timed out/);
    await vi.advanceTimersByTimeAsync(25);
    FakeWebSocket.instances[0]!.emit('close');
    await assertion;
  });

  it('rejects a WebSocket error and ignores a later close', async () => {
    const waiting = new VibeClient().fetchConversation('process', 1_000);
    FakeWebSocket.instances[0]!.emit('error', { error: new Error('socket failed') });
    FakeWebSocket.instances[0]!.emit('close');
    await expect(waiting).rejects.toThrow('socket failed');
  });

  it('derives final response from normalized logs when final-response is not a JSON API', async () => {
    const responses = [
      new Response('<html>VK app fallback</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      Response.json({ success: true, data: { id: 'process', session_id: 'session', status: 'completed', created_at: '2026-09-21T00:00:00.000Z', started_at: '2026-09-21T00:00:00.000Z', completed_at: '2026-09-21T00:00:01.000Z', updated_at: '2026-09-21T00:00:01.000Z', exit_code: 0, dropped: false, run_reason: 'codingagent', executor_action: {} }, error_data: null, message: null }),
    ];
    globalThis.fetch = vi.fn(async () => responses.shift() ?? Response.json({ success: false, data: null, error_data: null, message: 'unexpected' })) as typeof fetch;

    const waiting = new VibeClient('http://vk.test').getExecutionProcessFinalResponse('process');
    await vi.waitUntil(() => FakeWebSocket.instances.length === 1);
    FakeWebSocket.instances[0]!.emit('message', { data: JSON.stringify({ JsonPatch: [{ op: 'add', path: '/entries', value: [{ content: { entry_type: { type: 'assistant_message' }, content: 'DONE' } }] }] }) });
    FakeWebSocket.instances[0]!.emit('message', { data: JSON.stringify({ Ready: true }) });

    await expect(waiting).resolves.toMatchObject({
      process_id: 'process',
      status: 'completed',
      final_response: 'DONE',
      terminal_no_response: false,
    });
  });
});
