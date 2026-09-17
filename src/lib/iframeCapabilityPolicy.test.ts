import { describe, expect, it } from 'vitest';
import { resolveIframeCapabilityPolicy as resolveApprovedM14Policy } from '../../spikes/dockview-contract/iframeCapabilityPolicy';
import {
  IFRAME_CAPABILITY_NAMES,
  resolveIframeCapabilityPolicy,
  validateIframeRuntimeMessage,
  type IframeCapabilityName,
  type IframeProvenance,
} from './iframeCapabilityPolicy';

const approvedMatrix: Record<IframeProvenance, IframeCapabilityName[]> = {
  'vd-built-in': ['scripts', 'same-origin', 'forms', 'modals', 'clipboard-read', 'clipboard-write', 'fullscreen'],
  'vk-built-in': ['scripts', 'same-origin', 'forms', 'modals', 'clipboard-read', 'clipboard-write', 'fullscreen'],
  'installed-plugin': ['scripts', 'fullscreen'],
  'forwarded-project': ['scripts', 'forms'],
  'external-url': ['scripts'],
};

describe('production iframe capability policy', () => {
  it.each(Object.keys(approvedMatrix) as IframeProvenance[])
  ('matches the approved M1.4 executable policy for %s', (provenance) => {
    const targetKey = `executable-matrix:${provenance}`;
    const resolvedUrl = provenance === 'forwarded-project'
      ? 'https://port-3000.dashboard.example.test/'
      : 'https://target.example.test/';
    const requested = [...IFRAME_CAPABILITY_NAMES];
    const redirectGuards = {
      [targetKey]: { deliveryUrl: 'https://guard.example.test/delivery', upstreamOrigin: new URL(resolvedUrl).origin },
    };
    const production = resolveIframeCapabilityPolicy({ targetKey, provenance, resolvedUrl, requested }, {
      applicationOrigin: 'https://dashboard.example.test', redirectGuards,
    });
    const approved = resolveApprovedM14Policy({ targetKey }, {
      baseOrigin: 'https://dashboard.example.test',
      definitions: { [targetKey]: {
        provenance, resolvedUrl, requested,
        ...(provenance === 'installed-plugin'
          ? { pluginId: 'plugin', pluginVersion: '1.0.0', contributionKey: 'surface' }
          : {}),
      } },
      plugins: provenance === 'installed-plugin'
        ? { plugin: { version: '1.0.0', contributions: { surface: { allowed: requested } } } }
        : {},
      redirectGuards,
    });
    expect(production.ok).toBe(true);
    expect(approved.ok).toBe(true);
    if (!production.ok || !approved.ok) return;
    const { provenance: _approvedProvenance, ...approvedPolicy } = approved.policy;
    expect(production.policy).toEqual(approvedPolicy);
  });

  it.each(Object.entries(approvedMatrix) as Array<[IframeProvenance, IframeCapabilityName[]]>)
  ('matches the approved M1.4 matrix for every capability in %s', (provenance, allowed) => {
    const targetKey = `matrix:${provenance}`;
    const resolvedUrl = provenance === 'forwarded-project'
      ? 'https://port-3000.dashboard.example.test/'
      : 'https://target.example.test/';
    const environment = {
      applicationOrigin: 'https://dashboard.example.test',
      redirectGuards: { [targetKey]: { deliveryUrl: 'https://guard.example.test/delivery', upstreamOrigin: new URL(resolvedUrl).origin } },
    };
    for (const capability of IFRAME_CAPABILITY_NAMES) {
      const result = resolveIframeCapabilityPolicy({ targetKey, provenance, resolvedUrl, requested: [capability] }, environment);
      if (!result.ok) throw new Error(`${provenance}/${capability}: ${result.reason}`);
      const property: Record<IframeCapabilityName, keyof typeof result.policy> = {
        scripts: 'scripts', 'same-origin': 'sameOrigin', forms: 'forms', modals: 'modals', downloads: 'downloads',
        popups: 'popups', 'popup-escape': 'popupEscape', 'top-navigation-by-user-activation': 'topNavigationByUserActivation',
        'clipboard-read': 'clipboardRead', 'clipboard-write': 'clipboardWrite', fullscreen: 'fullscreen',
      };
      expect(result.policy[property[capability]], `${provenance}/${capability}`).toBe(allowed.includes(capability));
      expect(result.policy.scripts, `${provenance}/${capability} baseline scripts`).toBe(true);
    }
  });

  it.each(Object.keys(approvedMatrix) as IframeProvenance[])
  ('grants only baseline scripts for empty/tightened %s requests', (provenance) => {
    const resolvedUrl = provenance === 'forwarded-project'
      ? 'https://port-3000.dashboard.example.test/'
      : 'https://target.example.test/';
    const result = resolveIframeCapabilityPolicy({ targetKey: provenance, provenance, resolvedUrl, requested: [] }, {
      applicationOrigin: 'https://dashboard.example.test', redirectGuards: {},
    });
    expect(result).toMatchObject({ ok: true, policy: {
      scripts: true, sameOrigin: false, forms: false, modals: false, downloads: false,
      popups: false, popupEscape: false, topNavigationByUserActivation: false,
      clipboardRead: false, clipboardWrite: false, fullscreen: false,
    } });
  });

  it.each([null, 'scripts', { 0: 'scripts' }, ['scripts', 'root-access']])
  ('fails closed for malformed or unknown requests: %j', (requested) => {
    expect(resolveIframeCapabilityPolicy({ targetKey: 'bad', provenance: 'external-url', resolvedUrl: 'https://target.example.test/', requested }, {
      applicationOrigin: 'https://dashboard.example.test', redirectGuards: {},
    })).toEqual({ ok: false, reason: 'invalid-definition' });
  });

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
