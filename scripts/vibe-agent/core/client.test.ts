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
  beforeEach(() => { FakeWebSocket.instances = []; globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket; });
  afterEach(() => { globalThis.WebSocket = original; vi.useRealTimers(); });

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
});
