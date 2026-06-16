import { describe, expect, it, vi } from 'vitest';
import { PluginIframeHostBridge, type WindowLike } from '../src/host-bridge';
import { createPluginIframeRpcEnvelope } from '../src/protocol';

describe('PluginIframeHostBridge', () => {
  it('routes messages only from the registered iframe window with matching nonce', () => {
    const bridge = new PluginIframeHostBridge();
    const iframeWindow = createWindow();
    const attackerWindow = createWindow();

    bridge.registerFrame({
      pluginId: 'dev.example.plugin',
      frameId: 'frame-1',
      nonce: 'nonce-1',
      targetWindow: iframeWindow,
    });

    const request = createPluginIframeRpcEnvelope({
      pluginId: 'dev.example.plugin',
      frameId: 'frame-1',
      nonce: 'nonce-1',
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'contribution.register',
        params: {
          slot: 'sidebar',
          data: {
            text: '<script>alert("not html")</script>',
          },
        },
      },
    });

    expect(bridge.receive({ data: request, source: attackerWindow })).toBeNull();
    expect(bridge.receive({ data: { ...request, nonce: 'old-nonce' }, source: iframeWindow })).toBeNull();

    expect(bridge.receive({ data: request, source: iframeWindow })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    });
    expect(bridge.getContributions()).toEqual([
      {
        pluginId: 'dev.example.plugin',
        slot: 'sidebar',
        data: {
          text: '<script>alert("not html")</script>',
        },
      },
    ]);
  });

  it('sends parent-to-iframe messages through the registered WindowProxy', () => {
    const bridge = new PluginIframeHostBridge({ targetOrigin: '*' });
    const iframeWindow = createWindow();

    bridge.registerFrame({
      pluginId: 'dev.example.plugin',
      frameId: 'frame-1',
      nonce: 'nonce-1',
      targetWindow: iframeWindow,
    });

    expect(
      bridge.send('frame-1', {
        jsonrpc: '2.0',
        id: 'host-1',
        method: 'host.context',
        params: { theme: 'dark' },
      }),
    ).toBe(true);

    expect(iframeWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'dev.example.plugin',
        frameId: 'frame-1',
        nonce: 'nonce-1',
        data: expect.objectContaining({ method: 'host.context' }),
      }),
      '*',
    );
  });

  it('uses an exact postMessage targetOrigin when the host knows the plugin origin', () => {
    const bridge = new PluginIframeHostBridge({ targetOrigin: 'https://plugins.example.test' });
    const iframeWindow = createWindow();
    bridge.registerFrame({
      pluginId: 'dev.example.plugin',
      frameId: 'frame-1',
      nonce: 'nonce-1',
      targetWindow: iframeWindow,
    });

    expect(
      bridge.send('frame-1', {
        jsonrpc: '2.0',
        id: 'host-2',
        method: 'host.context',
      }),
    ).toBe(true);

    expect(iframeWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: 'host-2' }) }),
      'https://plugins.example.test',
    );
  });

  it('rejects unsupported RPC methods with JSON-RPC method-not-found', () => {
    const bridge = new PluginIframeHostBridge();
    const iframeWindow = createWindow();
    bridge.registerFrame({
      pluginId: 'dev.example.plugin',
      frameId: 'frame-1',
      nonce: 'nonce-1',
      targetWindow: iframeWindow,
    });

    const response = bridge.receive({
      source: iframeWindow,
      data: createPluginIframeRpcEnvelope({
        pluginId: 'dev.example.plugin',
        frameId: 'frame-1',
        nonce: 'nonce-1',
        data: {
          jsonrpc: '2.0',
          id: 3,
          method: 'workspace.deleteEverything',
        },
      }),
    });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: {
        code: -32601,
        message: 'Method not found: workspace.deleteEverything',
      },
    });
  });
});

function createWindow(): WindowLike {
  return {
    postMessage: vi.fn(),
  };
}
