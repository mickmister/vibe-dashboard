import { describe, expect, it, vi } from 'vitest';
import { installRuntimeInactivityBrowserSignal } from './runtimeInactivityBrowserSignal';

describe('installRuntimeInactivityBrowserSignal', () => {
  it('emits bounded browser/editor activity without raw page details', () => {
    let current = new Date('2026-09-02T20:00:00.000Z').getTime();
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 202 }));
    const listeners = new Map<string, EventListener>();
    const documentObj = {
      visibilityState: 'visible' as Document['visibilityState'],
      addEventListener: vi.fn((event: string, listener: EventListener) => listeners.set(event, listener)),
      removeEventListener: vi.fn(),
    };
    const windowListeners = new Map<string, EventListener>();
    const windowObj = {
      addEventListener: vi.fn((event: string, listener: EventListener) => windowListeners.set(event, listener)),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 123),
      clearInterval: vi.fn(),
    };

    const controller = installRuntimeInactivityBrowserSignal({
      fetchImpl,
      sendBeacon: undefined,
      windowObj: windowObj as never,
      documentObj: documentObj as never,
      now: () => new Date(current),
      minSendIntervalMs: 5_000,
    });

    expect(controller).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith('/internal/inactivity/browser-activity', expect.objectContaining({
      method: 'POST',
      keepalive: true,
    }));
    const firstBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(firstBody).toEqual({
      schemaVersion: 'runtime-inactivity-browser-activity.v1',
      eventType: 'load',
      occurredAt: '2026-09-02T20:00:00.000Z',
      visibilityState: 'visible',
    });
    expect(JSON.stringify(firstBody)).not.toContain('http');
    expect(JSON.stringify(firstBody)).not.toContain('repo');

    current += 1_000;
    controller?.sendActivity('interaction');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    current += 5_000;
    controller?.sendActivity('interaction');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    controller?.stop();
    expect(windowObj.clearInterval).toHaveBeenCalledWith(123);
  });

  it('uses sendBeacon when available and falls back without throwing', () => {
    const sendBeacon = vi.fn(() => true);
    const fetchImpl = vi.fn();
    const documentObj = {
      visibilityState: 'hidden' as Document['visibilityState'],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const windowObj = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    };

    installRuntimeInactivityBrowserSignal({
      fetchImpl,
      sendBeacon: sendBeacon as never,
      windowObj: windowObj as never,
      documentObj: documentObj as never,
      now: () => new Date('2026-09-02T20:00:00.000Z'),
    });

    expect(sendBeacon).toHaveBeenCalledWith('/internal/inactivity/browser-activity', expect.any(Blob));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
