import { describe, expect, it } from 'vitest';
import { resolveIframeCapabilityPolicy, validateIframeRuntimeMessage } from './iframeCapabilityPolicy';

describe('production iframe capability policy', () => {
  it('requires a server-owned redirect guard for ambient capabilities', () => {
    const definition = {
      targetKey: 'code:workspace-1',
      provenance: 'vk-built-in' as const,
      resolvedUrl: 'https://vk.example.test/code',
      requested: ['scripts', 'same-origin', 'clipboard-read'] as const,
    };
    expect(resolveIframeCapabilityPolicy(definition, { applicationOrigin: 'https://dashboard.example.test', redirectGuards: {} }))
      .toEqual({ ok: false, reason: 'redirect-boundary-required' });
    expect(resolveIframeCapabilityPolicy(definition, {
      applicationOrigin: 'https://dashboard.example.test',
      redirectGuards: { 'code:workspace-1': { deliveryUrl: 'https://dashboard.example.test/guard/code', upstreamOrigin: 'https://vk.example.test' } },
    })).toMatchObject({ ok: true, policy: { resolvedUrl: 'https://dashboard.example.test/guard/code', messageOrigin: 'https://dashboard.example.test', navigationEnforcement: 'trusted-redirect-guard', sameOrigin: true, clipboardRead: true } });
  });

  it('rejects mismatched guards, malformed arrays, credentials, and plugin same-origin', () => {
    const environment = { applicationOrigin: 'https://dashboard.example.test', redirectGuards: { plugin: { deliveryUrl: 'https://dashboard.example.test/guard', upstreamOrigin: 'https://wrong.test' } } };
    expect(resolveIframeCapabilityPolicy({ targetKey: 'plugin', provenance: 'vk-built-in', resolvedUrl: 'https://vk.example.test', requested: ['same-origin'] }, environment)).toMatchObject({ ok: false });
    expect(resolveIframeCapabilityPolicy({ targetKey: 'plugin', provenance: 'installed-plugin', resolvedUrl: 'https://plugin.example.test', requested: ['scripts', 'same-origin', 'fullscreen'] }, environment)).toMatchObject({ ok: true, policy: { scripts: true, sameOrigin: false, fullscreen: true, messageOrigin: null } });
    expect(resolveIframeCapabilityPolicy({ targetKey: 'bad', provenance: 'external-url', resolvedUrl: 'https://user:pass@example.test', requested: ['scripts'] }, environment)).toMatchObject({ ok: false, reason: 'invalid-definition' });
    expect(resolveIframeCapabilityPolicy({ targetKey: 'bad', provenance: 'external-url', resolvedUrl: 'https://example.test', requested: ['unknown'] }, environment)).toMatchObject({ ok: false, reason: 'invalid-definition' });
  });

  it('rejects invalid forwarded origins and enforces runtime message identity', () => {
    const environment = { applicationOrigin: 'https://dashboard.example.test', redirectGuards: { vk: { deliveryUrl: 'https://dashboard.example.test/guard', upstreamOrigin: 'https://vk.example.test' } } };
    expect(resolveIframeCapabilityPolicy({ targetKey: 'preview', provenance: 'forwarded-project', resolvedUrl: 'https://port-3000.dashboard.example.test.evil.test', requested: ['forms'] }, environment))
      .toEqual({ ok: false, reason: 'invalid-definition' });
    const resolved = resolveIframeCapabilityPolicy({ targetKey: 'vk', provenance: 'vk-built-in', resolvedUrl: 'https://vk.example.test', requested: ['same-origin'] }, environment);
    if (!resolved.ok) throw new Error(resolved.reason);
    const sourceWindow = {};
    const registration = { runtimeId: 'runtime', panelId: 'panel', generation: 2, sourceWindow, policy: resolved.policy };
    const data = { schemaVersion: 1, type: 'runtime-ready', runtimeId: 'runtime', panelId: 'panel', generation: 2, payload: { protocolVersion: 1 } };
    expect(validateIframeRuntimeMessage({ origin: 'https://dashboard.example.test', source: sourceWindow, data }, registration).ok).toBe(true);
    expect(validateIframeRuntimeMessage({ origin: 'https://evil.test', source: sourceWindow, data }, registration).ok).toBe(false);
  });
});
