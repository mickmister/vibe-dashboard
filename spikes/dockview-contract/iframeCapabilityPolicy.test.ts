import { describe, expect, it } from 'vitest';
import { applyRuntimeLease, resolveIframeCapabilityPolicy, validateRuntimeMessage, type CapabilityRegistry, type RuntimeRegistration } from './iframeCapabilityPolicy';

const registry: CapabilityRegistry = {
  baseOrigin: 'https://vd.example.test',
  definitions: {
    vd: { provenance: 'vd-built-in', resolvedUrl: 'https://vd.example.test/dashboard', requested: ['same-origin', 'forms', 'clipboard-read', 'clipboard-write', 'fullscreen'] },
    vk: { provenance: 'vk-built-in', resolvedUrl: 'https://vk.example.test/workspaces/ws-1', requested: ['same-origin', 'forms', 'clipboard-read', 'clipboard-write', 'fullscreen'] },
    plugin: { provenance: 'installed-plugin', pluginId: 'notes', resolvedUrl: 'https://plugins.example.test/notes/', requested: ['same-origin', 'clipboard-read', 'downloads', 'fullscreen'] },
    forwarded: { provenance: 'forwarded-project', resolvedUrl: 'https://port-5173.vd.example.test/', requested: ['same-origin', 'forms', 'clipboard-write', 'fullscreen'] },
    external: { provenance: 'external-url', resolvedUrl: 'https://docs.example.org/', requested: ['same-origin', 'clipboard-read', 'fullscreen'] },
  },
  installedPlugins: new Set(['notes']),
};

describe('resolver-derived iframe capability policy', () => {
  it.each([
    ['vd', 'vd-built-in', true, true], ['vk', 'vk-built-in', true, true], ['plugin', 'installed-plugin', true, false],
    ['forwarded', 'forwarded-project', false, false], ['external', 'external-url', false, false],
  ] as const)('applies the concrete ceiling for %s', (targetKey, provenance, sameOrigin, clipboard) => {
    expect(resolveIframeCapabilityPolicy({ targetKey }, registry)).toMatchObject({ ok: true, policy: { provenance, sameOrigin, clipboardRead: clipboard, clipboardWrite: clipboard } });
  });

  it('materializes sandbox and Permissions Policy attributes with risky tokens absent', () => {
    const plugin = resolveIframeCapabilityPolicy({ targetKey: 'plugin' }, registry);
    if (!plugin.ok) throw new Error('fixture');
    expect(plugin.policy.sandbox.split(' ')).toEqual(['allow-scripts', 'allow-same-origin']);
    expect(plugin.policy.allow).toBe('fullscreen');
    expect(plugin.policy).toMatchObject({ forms: false, modals: false, downloads: false, popups: false, popupEscape: false, topNavigationByUserActivation: false });

    const forwarded = resolveIframeCapabilityPolicy({ targetKey: 'forwarded' }, registry);
    if (!forwarded.ok) throw new Error('fixture');
    expect(forwarded.policy.sandbox.split(' ')).toEqual(['allow-scripts', 'allow-forms']);
    expect(forwarded.policy.allow).toBe('');
  });

  it('defaults unknowns to denial and ignores serialized authority claims', () => {
    expect(resolveIframeCapabilityPolicy({ targetKey: 'missing', claimedProvenance: 'vd-built-in', claimedCapabilities: ['same-origin'] }, registry)).toEqual({ ok: false, reason: 'target-unavailable' });
    expect(resolveIframeCapabilityPolicy({ targetKey: 'external', claimedProvenance: 'vd-built-in', claimedCapabilities: ['same-origin'] }, registry)).toMatchObject({ ok: true, policy: { provenance: 'external-url', sameOrigin: false } });
  });

  it('clips plugin claims to VD ceilings and uses current definitions', () => {
    expect(resolveIframeCapabilityPolicy({ targetKey: 'plugin' }, registry)).toMatchObject({ ok: true, policy: { sameOrigin: true, downloads: false, clipboardRead: false, fullscreen: true } });
    const tightened: CapabilityRegistry = { ...registry, definitions: { ...registry.definitions, plugin: { provenance: 'installed-plugin', pluginId: 'notes', resolvedUrl: 'https://plugins.example.test/notes/', requested: [] } } };
    expect(resolveIframeCapabilityPolicy({ targetKey: 'plugin' }, tightened)).toMatchObject({ ok: true, policy: { sameOrigin: false, fullscreen: false } });
    expect(resolveIframeCapabilityPolicy({ targetKey: 'plugin' }, { ...registry, installedPlugins: new Set() })).toEqual({ ok: false, reason: 'plugin-unavailable' });
    const hostOriginPlugin: CapabilityRegistry = { ...registry, definitions: { sameHost: { provenance: 'installed-plugin', pluginId: 'notes', resolvedUrl: 'https://vd.example.test/plugin.js', requested: ['same-origin'] } } };
    expect(resolveIframeCapabilityPolicy({ targetKey: 'sameHost' }, hostOriginPlugin)).toMatchObject({ ok: true, policy: { sameOrigin: false, messageOrigin: null } });
  });

  it('treats port-* as routing, not trust, and never upgrades on redirect', () => {
    const forwarded = resolveIframeCapabilityPolicy({ targetKey: 'forwarded' }, registry);
    if (!forwarded.ok) throw new Error('fixture');
    expect(forwarded.policy).toMatchObject({ provenance: 'forwarded-project', sameOrigin: false, clipboardWrite: false });
    expect(forwarded.policy.acceptsNavigation('https://vd.example.test/dashboard')).toBe(false);
    expect(forwarded.policy.acceptsNavigation('https://port-5173.vd.example.test/editor')).toBe(true);
    const external = resolveIframeCapabilityPolicy({ targetKey: 'external' }, registry);
    if (!external.ok) throw new Error('fixture');
    expect(external.policy.acceptsNavigation('https://vd.example.test/dashboard')).toBe(true);
    expect(external.policy.provenance).toBe('external-url');
    for (const resolvedUrl of ['https://port-0.vd.example.test/', 'https://port-65536.vd.example.test/', 'https://port-5173.vd.example.test.evil.test/']) {
      const invalid: CapabilityRegistry = { ...registry, definitions: { ...registry.definitions, forwarded: { provenance: 'forwarded-project', resolvedUrl, requested: ['forms'] } } };
      expect(resolveIframeCapabilityPolicy({ targetKey: 'forwarded' }, invalid)).toEqual({ ok: false, reason: 'invalid-definition' });
    }
  });

  it('validates malformed URLs and keeps Split leasing capability-identical', () => {
    const malformed: CapabilityRegistry = { ...registry, definitions: { ...registry.definitions, bad: { provenance: 'external-url', resolvedUrl: 'javascript:alert(1)', requested: [] } } };
    expect(resolveIframeCapabilityPolicy({ targetKey: 'bad' }, malformed)).toEqual({ ok: false, reason: 'invalid-definition' });
    const malformedClass = { ...registry, definitions: { bad: { provenance: 'future-class', resolvedUrl: 'https://safe.test', requested: [] } } } as unknown as CapabilityRegistry;
    expect(resolveIframeCapabilityPolicy({ targetKey: 'bad' }, malformedClass)).toEqual({ ok: false, reason: 'invalid-definition' });
    const caddyLookalike: CapabilityRegistry = { ...registry, definitions: { custom: { provenance: 'external-url', resolvedUrl: 'https://port-5173.vd.example.test/', requested: ['same-origin', 'clipboard-read'] } } };
    expect(resolveIframeCapabilityPolicy({ targetKey: 'custom' }, caddyLookalike)).toMatchObject({ ok: true, policy: { provenance: 'external-url', sameOrigin: false, clipboardRead: false } });
    const resolved = resolveIframeCapabilityPolicy({ targetKey: 'plugin' }, registry);
    if (!resolved.ok) throw new Error('fixture');
    const runtime: RuntimeRegistration = { runtimeId: 'runtime-1', panelId: 'panel-1', generation: 3, sourceWindow: {}, policy: resolved.policy };
    expect(applyRuntimeLease(runtime, 'split-host').registration.policy).toBe(runtime.policy);
  });

  it.each([
    'https://vd.example.test.evil.test/',
    'https://vd.example.test@evil.test/',
    'https://port-5173.vd.example.test.evil.test/',
  ])('does not elevate a host-confusing custom URL: %s', (resolvedUrl) => {
    const custom: CapabilityRegistry = { ...registry, definitions: { ...registry.definitions, custom: { provenance: 'external-url', resolvedUrl, requested: ['same-origin', 'clipboard-read', 'fullscreen'] } } };
    const result = resolveIframeCapabilityPolicy({ targetKey: 'custom' }, custom);
    if (resolvedUrl.includes('@')) expect(result).toEqual({ ok: false, reason: 'invalid-definition' });
    else expect(result).toMatchObject({ ok: true, policy: { provenance: 'external-url', sameOrigin: false, clipboardRead: false, fullscreen: false } });
  });
});

describe('postMessage boundary', () => {
  it('requires exact origin, source, schema, Panel/runtime identity, and generation', () => {
    const sourceWindow = {};
    const resolved = resolveIframeCapabilityPolicy({ targetKey: 'vk' }, registry);
    if (!resolved.ok) throw new Error('fixture');
    const registration: RuntimeRegistration = { runtimeId: 'runtime-1', panelId: 'panel-1', generation: 7, sourceWindow, policy: resolved.policy };
    const data = { schemaVersion: 1, type: 'runtime-ready', runtimeId: 'runtime-1', panelId: 'panel-1', generation: 7, payload: {} };
    expect(validateRuntimeMessage({ origin: 'https://vk.example.test', source: sourceWindow, data }, registration)).toMatchObject({ ok: true });
    for (const event of [
      { origin: 'https://evil.test', source: sourceWindow, data }, { origin: 'https://vk.example.test', source: {}, data },
      { origin: 'https://vk.example.test', source: sourceWindow, data: { ...data, schemaVersion: 2 } }, { origin: 'https://vk.example.test', source: sourceWindow, data: { ...data, panelId: 'other' } },
      { origin: 'https://vk.example.test', source: sourceWindow, data: { ...data, runtimeId: 'other' } }, { origin: 'https://vk.example.test', source: sourceWindow, data: { ...data, generation: 6 } },
      { origin: 'https://vk.example.test', source: sourceWindow, data: { ...data, extra: true } },
    ]) expect(validateRuntimeMessage(event, registration).ok).toBe(false);
  });
});
