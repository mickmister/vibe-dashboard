/* eslint-disable formatjs/no-literal-string-in-object -- trusted registry fixtures, not UI copy */
import { describe, expect, it, vi } from 'vitest';
import { createEmptyPluginRegistryState, type PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import {
  classifyLegacyPanelRepresentation,
  createPanelTargetRegistry,
  findSplitCompatibleTargets,
  type PanelTargetResolutionContext,
  type StoredPanelTarget,
} from './panelTargetRegistry';

const workspace = {
  id: 'workspace-1',
  available: true,
  directory: '/trusted/project',
  origin: 'https://vk.example.test',
  repositoryIds: ['repo-1'],
  locations: {
    overview: '/workspaces/workspace-1',
    code: '/?folder=%2Ftrusted%2Fproject',
    changes: '/workspaces/workspace-1/changes',
    beads: 'https://beads.example.test/workspace-1',
    forms: '/workspaces/workspace-1/forms',
  },
};

function plugins(): PluginRegistryState {
  const state = createEmptyPluginRegistryState();
  state.plugins['plugin.docs'] = {
    id: 'plugin.docs', displayName: 'Docs', version: '2.0.0', apiVersion: '1.0.0', registeredAt: 'now',
    frontend: { allowSameOrigin: true }, contributions: {},
  };
  state.craftSurfaces['plugin.docs/site'] = {
    key: 'plugin.docs/site', sourceKey: 'site', pluginId: 'plugin.docs', title: 'Docs',
    urlTemplate: '{{origin}}/dashboard/plugins/plugin.docs/2.0.0/frontend_assets/index.html',
  };
  state.internalRoutes['plugin.docs/help'] = {
    key: 'plugin.docs/help', sourceKey: 'help', pluginId: 'plugin.docs', title: 'Help', path: '/help',
    urlTemplate: '{{origin}}/dashboard/plugins/plugin.docs/2.0.0/frontend_assets/help.html',
  };
  return state;
}

function context(overrides: Partial<PanelTargetResolutionContext> = {}): PanelTargetResolutionContext {
  return {
    craftId: 'craft-1',
    hostOrigin: 'https://dashboard.example.test',
    crafts: { 'craft-1': { workspaceId: 'workspace-1', allowedPluginTargets: ['plugin.docs/site', 'plugin.docs/help'] } },
    workspaces: { 'workspace-1': workspace },
    agentSessions: { 'session-1': { workspaceId: 'workspace-1', location: '/sessions/session-1' } },
    terminals: { 'terminal-1': { workspaceId: 'workspace-1', location: '/terminals/terminal-1' } },
    previews: { 'preview-1': { workspaceId: 'workspace-1', location: 'https://port-3000.dashboard.example.test' } },
    builtInRoutes: { settings: { location: '/settings', allowedCraftIds: ['craft-1'] } },
    getPluginRegistry: plugins,
    pluginCapabilities: {
      'plugin.docs/site': ['scripts', 'fullscreen', 'same-origin'],
      'plugin.docs/help': ['scripts'],
    },
    ...overrides,
  };
}

const stored = (kind: string, payload: Record<string, unknown>, version = 1): StoredPanelTarget => ({ kind, version, payload });

describe('production Panel target registry', () => {
  it('strictly parses every approved v1 family and deterministically migrates v0 aliases', () => {
    const registry = createPanelTargetRegistry();
    const cases = [
      stored('craft-overview', { workspaceId: 'workspace-1' }),
      stored('agent-session', { workspaceId: 'workspace-1', sessionId: 'session-1' }),
      stored('code', { workspaceId: 'workspace-1', repoId: 'repo-1', folderIntent: 'repository' }),
      stored('changes', { workspaceId: 'workspace-1', repoId: 'repo-1' }),
      stored('beads', { workspaceId: 'workspace-1' }),
      stored('forms', { workspaceId: 'workspace-1', formId: 'form-1' }),
      stored('terminal', { workspaceId: 'workspace-1', terminalId: 'terminal-1' }),
      stored('preview', { workspaceId: 'workspace-1', previewId: 'preview-1' }),
      stored('internal-route', { routeId: 'settings', params: {} }),
      stored('custom-url', { url: 'https://docs.example.test/path' }),
      stored('plugin-surface', { pluginId: 'plugin.docs', surfaceId: 'site', params: {} }),
    ];
    for (const target of cases) expect(registry.resolve(target, context())).toMatchObject({ status: 'resolved' });
    expect(registry.resolve(stored('custom-url', { requestedUrl: 'https://docs.example.test' }, 0), context()))
      .toMatchObject({ status: 'resolved', target: { version: 1, payload: { url: 'https://docs.example.test/' } } });
    expect(registry.resolve(stored('plugin-surface', { pluginId: 'plugin.docs', surfaceKey: 'site', params: {} }, 0), context()))
      .toMatchObject({ status: 'resolved', target: { version: 1, payload: { surfaceId: 'site' } } });
  });

  it.each([
    [stored('code', { workspaceId: 'workspace-1', injectedUrl: 'https://evil.test' }), 'malformed'],
    [stored('unknown', {}), 'unknown-kind'],
    [stored('code', { workspaceId: 'workspace-1' }, 99), 'unsupported-version'],
    [{ kind: 'code', version: 1, payload: null }, 'malformed'],
  ])('quarantines malformed/unknown target %#', (target, reason) => {
    expect(createPanelTargetRegistry().resolve(target, context())).toEqual(expect.objectContaining({ status: 'quarantined', reason }));
  });

  it('derives canonical locations, identity, provenance, and policy from current trusted state only', () => {
    const result = createPanelTargetRegistry().resolve({
      ...stored('code', { workspaceId: 'workspace-1', repoId: 'repo-1', folderIntent: 'repository' }),
      canonicalLocation: 'https://evil.test', provenance: 'installed-plugin', capabilities: ['same-origin'],
    }, context());
    expect(result).toMatchObject({
      status: 'resolved', rendererKey: 'workspace-code', canonicalLocation: 'https://vk.example.test/?folder=%2Ftrusted%2Fproject',
      effectiveProvenance: 'vk-built-in', equivalenceIdentity: 'code\0workspace-1\0repo-1\0repository',
      backendSharingIdentity: 'workspace\0workspace-1', capabilityPolicy: { sameOrigin: true },
    });
  });

  it('enforces authoritative Craft ownership, workspace scope, repositories, and backend ownership', () => {
    const registry = createPanelTargetRegistry();
    expect(registry.resolve(stored('code', { workspaceId: 'workspace-2' }), context())).toMatchObject({ reason: 'workspace-owner-mismatch' });
    expect(registry.resolve(stored('code', { workspaceId: 'workspace-1', repoId: 'foreign' }), context())).toMatchObject({ reason: 'target-scope-denied' });
    expect(registry.resolve(stored('agent-session', { workspaceId: 'workspace-1', sessionId: 'missing' }), context())).toMatchObject({ reason: 'target-unavailable' });
    expect(registry.resolve(stored('terminal', { workspaceId: 'workspace-1', terminalId: 'terminal-1' }), context({ craftId: 'missing' }))).toMatchObject({ reason: 'craft-unavailable' });
  });

  it('uses exact production plugin contribution identity and denies plugin same-origin in v1', () => {
    const registry = createPanelTargetRegistry();
    const surface = registry.resolve(stored('plugin-surface', { pluginId: 'plugin.docs', surfaceId: 'site', params: {} }), context());
    expect(surface).toMatchObject({ status: 'resolved', rendererKey: 'plugin-iframe', effectiveProvenance: 'installed-plugin', capabilityPolicy: { scripts: true, fullscreen: true, sameOrigin: false } });
    const route = registry.resolve(stored('internal-route', { routeId: 'plugin.docs/help', params: { topic: 'api' } }), context());
    expect(route).toMatchObject({ status: 'resolved', factoryKey: 'plugin-internal-route:plugin.docs/help', canonicalLocation: 'https://dashboard.example.test/dashboard/plugins/plugin.docs/2.0.0/frontend_assets/help.html?topic=api', canonicalPayload: { pluginId: 'plugin.docs', routeKey: 'help', routePath: '/help' } });
    expect(registry.resolve(stored('internal-route', { routeId: 'plugin.docs/missing', params: {} }), context())).toMatchObject({ reason: 'target-unavailable' });
  });

  it('immediately removes privileges for removed/tightened plugins and validates capability arrays', () => {
    let snapshot = plugins();
    const getPluginRegistry = () => snapshot;
    const registry = createPanelTargetRegistry();
    const target = stored('plugin-surface', { pluginId: 'plugin.docs', surfaceId: 'site', params: {} });
    expect(registry.resolve(target, context({ getPluginRegistry }))).toMatchObject({ capabilityPolicy: { fullscreen: true } });
    expect(registry.resolve(target, context({ getPluginRegistry, pluginCapabilities: { 'plugin.docs/site': ['scripts', 'bogus'] } as never }))).toMatchObject({ reason: 'invalid-capability-policy' });
    snapshot = createEmptyPluginRegistryState();
    expect(registry.resolve(target, context({ getPluginRegistry }))).toMatchObject({ reason: 'plugin-unavailable', capabilityPolicy: { scripts: false, sameOrigin: false } });
  });

  it('rejects unsafe custom URLs, credentials, internal schemes, and custom resolver exceptions', () => {
    const registry = createPanelTargetRegistry();
    for (const url of ['javascript:alert(1)', 'internal://plugins/plugin.docs/help', 'https://user:pass@example.test']) {
      expect(registry.resolve(stored('custom-url', { url }), context())).toMatchObject({ reason: 'unsafe-url' });
    }
    expect(registry.resolve(stored('custom-url', { url: 'https://ok.example.test' }), context({ resolveCustomUrl: () => { throw new Error('boom'); } }))).toMatchObject({ reason: 'resolver-failed' });
  });

  it('derives generic Split compatibility and backend sharing from resolved capabilities', () => {
    const registry = createPanelTargetRegistry();
    const agent = registry.resolve(stored('agent-session', { workspaceId: 'workspace-1', sessionId: 'session-1' }), context());
    if (agent.status !== 'resolved') throw new Error(agent.reason);
    const compatible = findSplitCompatibleTargets(agent, [
      stored('forms', { workspaceId: 'workspace-1' }),
      stored('custom-url', { url: 'https://docs.example.test' }),
      stored('terminal', { workspaceId: 'workspace-1', terminalId: 'terminal-1' }),
    ], context(), registry);
    expect(compatible.map((item) => item.target.kind)).toEqual(['forms', 'terminal']);
    expect(compatible.every((item) => item.splitClass === 'workspace-tool')).toBe(true);
  });

  it('fails closed when a trusted custom definition returns malformed output or throws', () => {
    const registry = createPanelTargetRegistry({
      customDefinitions: [{ kind: 'broken', version: 1, parse: () => ({}), migrate: vi.fn(), resolve: () => ({ bad: true }) as never }],
    });
    expect(registry.resolve(stored('broken', {}), context())).toMatchObject({ reason: 'invalid-resolver-result' });
    expect(() => createPanelTargetRegistry({ customDefinitions: [{ kind: 'code', version: 1, parse: () => ({}), migrate: () => ({}), resolve: () => null }] }))
      .toThrow('Duplicate Panel target definition');
  });
});

describe('approved migration classification boundary', () => {
  it.each([
    [{ groupId: 'tg_home', view: { id: 'x', url: 'https://example.test' } }, 'homepage-representation'],
    [{ groupId: 'craft', view: { id: 'tab_overview', url: 'https://example.test' } }, 'homepage-representation'],
    [{ groupId: 'craft', view: { id: 'x', url: 'internal://spaces-overview' } }, 'homepage-representation'],
    [{ groupId: 'craft', view: { id: 'x', url: '/x', ephemeral: { kind: 'craft-surface' } } }, 'ephemeral-plugin-placeholder'],
  ])('preserves skipped classification %#', (input, reason) => {
    expect(classifyLegacyPanelRepresentation(input)).toEqual({ outcome: 'skip', reason });
  });

  it('audits production-shaped pair tabIds independently without implementing the runner', () => {
    expect(classifyLegacyPanelRepresentation({ groupId: 'craft', view: { id: 'pair', url: '' }, pair: { tabIds: ['agent', 'missing'] }, views: [{ id: 'agent', url: '/agent' }] })).toEqual({
      outcome: 'pair-audit', diagnostics: [{ tabId: 'agent', status: 'present' }, { tabId: 'missing', status: 'missing' }],
    });
  });
});
