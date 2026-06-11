import { describe, expect, it } from 'vitest';
import {
  PLUGIN_IFRAME_RPC_PROTOCOL_VERSION,
  createPluginIframeRpcEnvelope,
  parsePluginIframeRpcEnvelope,
} from '../src/protocol';

describe('plugin iframe RPC protocol', () => {
  it('accepts valid JSON-RPC envelopes', () => {
    const envelope = createPluginIframeRpcEnvelope({
      pluginId: 'dev.example.plugin',
      frameId: 'frame-1',
      nonce: 'nonce-1',
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'contribution.register',
        params: {
          slot: 'sidebar',
          data: { text: 'hello' },
        },
      },
    });

    expect(parsePluginIframeRpcEnvelope(envelope)).toEqual(envelope);
  });

  it('rejects malformed or unsupported envelopes', () => {
    const valid = createPluginIframeRpcEnvelope({
      pluginId: 'dev.example.plugin',
      frameId: 'frame-1',
      nonce: 'nonce-1',
      data: { jsonrpc: '2.0', id: 'a', method: 'ping' },
    });

    expect(parsePluginIframeRpcEnvelope({ ...valid, protocolVersion: 999 })).toBeNull();
    expect(parsePluginIframeRpcEnvelope({ ...valid, pluginId: '' })).toBeNull();
    expect(parsePluginIframeRpcEnvelope({ ...valid, data: { jsonrpc: '2.0', method: '' } })).toBeNull();
    expect(parsePluginIframeRpcEnvelope({ ...valid, data: { jsonrpc: '2.0', id: 1, method: 'x', params: Number.NaN } })).toBeNull();
  });

  it('keeps protocol version explicit for iframe compatibility checks', () => {
    expect(PLUGIN_IFRAME_RPC_PROTOCOL_VERSION).toBe(1);
  });
});
