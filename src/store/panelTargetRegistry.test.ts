/* eslint-disable formatjs/no-literal-string-in-object -- trusted registry fixtures, not UI copy */
import { describe, expect, it, vi } from 'vitest';
import { createEmptyPluginRegistryState, type PluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import {
  classifyLegacyPanelRepresentation,
  createPanelTargetRegistry,
  findSplitCompatibleTargets,
  getLegacyStoredPanelTarget,
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
    frontend: { allowSameOrigin: true }, contributions: {
      craftSurfaces: [{ key: 'site', title: 'Docs', urlTemplate: '{{origin}}/dashboard/plugins/plugin.docs/2.0.0/frontend_assets/index.html', capabilities: ['scripts', 'fullscreen', 'same-origin'] }],
      internalRoutes: [{ key: 'help', title: 'Help', path: '/help', urlTemplate: '{{origin}}/dashboard/plugins/plugin.docs/2.0.0/frontend_assets/help.html', allowedParams: ['topic'], capabilities: ['scripts'] }],
    },
  };
  state.craftSurfaces['plugin.docs/site'] = {
    key: 'plugin.docs/site', sourceKey: 'site', pluginId: 'plugin.docs', title: 'Docs',
    urlTemplate: '{{origin}}/dashboard/plugins/plugin.docs/2.0.0/frontend_assets/index.html', capabilities: ['scripts', 'fullscreen', 'same-origin'],
  };
  state.internalRoutes['plugin.docs/help'] = {
    key: 'plugin.docs/help', sourceKey: 'help', pluginId: 'plugin.docs', title: 'Help', path: '/help',
    urlTemplate: '{{origin}}/dashboard/plugins/plugin.docs/2.0.0/frontend_assets/help.html',
    allowedParams: ['topic'], capabilities: ['scripts'],
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
    redirectGuards: {
      'craft-overview:workspace-1': { deliveryUrl: 'https://dashboard.example.test/guard/overview', upstreamOrigin: 'https://vk.example.test' },
      'agent-session:session-1': { deliveryUrl: 'https://dashboard.example.test/guard/agent', upstreamOrigin: 'https://vk.example.test' },
      'code:workspace-1': { deliveryUrl: 'https://dashboard.example.test/guard/code', upstreamOrigin: 'https://vk.example.test' },
      'changes:workspace-1': { deliveryUrl: 'https://dashboard.example.test/guard/changes', upstreamOrigin: 'https://vk.example.test' },
      'beads:workspace-1': { deliveryUrl: 'https://dashboard.example.test/guard/beads', upstreamOrigin: 'https://beads.example.test' },
      'forms:workspace-1': { deliveryUrl: 'https://dashboard.example.test/guard/forms', upstreamOrigin: 'https://vk.example.test' },
      'terminal:terminal-1': { deliveryUrl: 'https://dashboard.example.test/guard/terminal', upstreamOrigin: 'https://vk.example.test' },
      'internal-route:settings': { deliveryUrl: 'https://dashboard.example.test/guard/settings', upstreamOrigin: 'https://dashboard.example.test' },
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

  it.each([
    ['agent-session', 'sessionId', 'session-1'],
    ['terminal', 'terminalId', 'terminal-1'],
    ['preview', 'previewId', 'preview-1'],
  ])('requires the strict %s backend identity schema', (kind, identity, knownId) => {
    const registry = createPanelTargetRegistry();
    expect(registry.resolve(stored(kind, { workspaceId: 'workspace-1' }), context())).toMatchObject({ reason: 'malformed' });
    expect(registry.resolve(stored(kind, { workspaceId: 'workspace-1', [identity]: '' }), context())).toMatchObject({ reason: 'malformed' });
    expect(registry.resolve(stored(kind, { workspaceId: 'workspace-1', [identity]: 'valid', extra: true }), context())).toMatchObject({ reason: 'malformed' });
    expect(registry.resolve(stored(kind, { workspaceId: 'workspace-1', [identity]: 'valid', extra: true }, 0), context())).toMatchObject({ reason: 'malformed' });
    expect(registry.resolve(stored(kind, { workspaceId: 'workspace-1', [identity]: 'valid' }, 2), context())).toMatchObject({ reason: 'unsupported-version' });
    expect(registry.resolve(stored(kind, { workspaceId: 'workspace-1', [identity]: knownId }, 0), context())).toMatchObject({ status: 'resolved', target: { version: 1 } });
  });

  it('derives canonical locations, identity, provenance, and policy from current trusted state only', () => {
    const registry = createPanelTargetRegistry();
    const target = stored('code', { workspaceId: 'workspace-1', repoId: 'repo-1', folderIntent: 'repository' });
    const result = registry.resolve(target, context());
    expect(result).toMatchObject({
      status: 'resolved', rendererKey: 'workspace-code', canonicalLocation: 'https://dashboard.example.test/guard/code',
      effectiveProvenance: 'vk-built-in', equivalenceIdentity: 'code\0workspace-1\0repo-1\0repository',
      backendSharingIdentity: 'workspace\0workspace-1', capabilityPolicy: { sameOrigin: true },
    });
    expect(registry.resolve({ ...target, canonicalLocation: 'https://evil.test', provenance: 'installed-plugin', capabilities: ['same-origin'] }, context()))
      .toMatchObject({ status: 'quarantined', reason: 'malformed', capabilityPolicy: { scripts: false, sameOrigin: false } });
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
    expect(route).toMatchObject({ status: 'resolved', factoryKey: 'plugin-internal-route:plugin.docs/help', canonicalLocation: 'https://dashboard.example.test/dashboard/plugins/plugin.docs/2.0.0/frontend_assets/help.html?topic=api', canonicalPayload: { pluginId: 'plugin.docs', routeKey: 'help', routePath: '/help', params: { topic: 'api' } }, equivalenceIdentity: 'plugin-internal-route\0plugin.docs/help\0{"topic":"api"}' });
    expect(registry.resolve(stored('internal-route', { routeId: 'plugin.docs/missing', params: {} }), context())).toMatchObject({ reason: 'target-unavailable' });
    for (const params of [{ unknown: 'x' }, { topic: { nested: true } }, { topic: 3 }]) {
      expect(registry.resolve(stored('internal-route', { routeId: 'plugin.docs/help', params }), context()))
        .toMatchObject({ reason: 'invalid-route-params' });
    }
    const malformedSchema = plugins();
    malformedSchema.plugins['plugin.docs']!.contributions.internalRoutes![0]!.allowedParams = ['topic', 'topic'];
    expect(registry.resolve(stored('internal-route', { routeId: 'plugin.docs/help', params: { topic: 'api' } }), context({ getPluginRegistry: () => malformedSchema })))
      .toMatchObject({ reason: 'invalid-route-params' });
    const ambiguous = plugins();
    ambiguous.internalRoutes['plugin.docs/help-copy'] = { ...ambiguous.internalRoutes['plugin.docs/help']!, key: 'plugin.docs/help-copy', sourceKey: 'help-copy' };
    expect(registry.resolve(stored('internal-route', { routeId: 'plugin.docs/help', params: {} }), context({ getPluginRegistry: () => ambiguous })))
      .toMatchObject({ reason: 'ambiguous-target' });
  });

  it('immediately removes privileges for removed/tightened plugins and validates capability arrays', () => {
    let snapshot = plugins();
    const getPluginRegistry = () => snapshot;
    const registry = createPanelTargetRegistry();
    const target = stored('plugin-surface', { pluginId: 'plugin.docs', surfaceId: 'site', params: {} });
    expect(registry.resolve(target, context({ getPluginRegistry }))).toMatchObject({ capabilityPolicy: { fullscreen: true } });
    snapshot.plugins['plugin.docs']!.contributions.craftSurfaces![0]!.capabilities = ['scripts'];
    expect(registry.resolve(target, context({ getPluginRegistry })))
      .toMatchObject({ status: 'resolved', capabilityPolicy: { scripts: true, fullscreen: false, sameOrigin: false } });
    (snapshot.plugins['plugin.docs']!.contributions.craftSurfaces![0] as { capabilities?: unknown }).capabilities = ['scripts', 'bogus'];
    expect(registry.resolve(target, context({ getPluginRegistry }))).toMatchObject({ reason: 'invalid-capability-policy' });
    snapshot = createEmptyPluginRegistryState();
    expect(registry.resolve(target, context({ getPluginRegistry }))).toMatchObject({ reason: 'plugin-unavailable', capabilityPolicy: { scripts: false, sameOrigin: false } });
  });

  it('rejects unsafe custom URLs, credentials, internal schemes, and custom resolver exceptions', () => {
    const registry = createPanelTargetRegistry();
    for (const url of ['javascript:alert(1)', 'internal://plugins/plugin.docs/help', 'https://user:pass@example.test']) {
      expect(registry.resolve(stored('custom-url', { url }), context())).toMatchObject({ reason: 'unsafe-url' });
    }
    expect(registry.resolve(stored('custom-url', { url: 'https://ok.example.test' }), context({ resolveCustomUrl: () => { throw new Error('boom'); } }))).toMatchObject({ reason: 'resolver-failed' });
    expect(registry.resolve(stored('internal-route', { routeId: 'settings', params: {} }), context({ builtInRoutes: { settings: { location: '/settings', allowedCraftIds: ['craft-1'], capabilities: ['scripts', 'unknown'] } } })))
      .toMatchObject({ reason: 'invalid-capability-policy' });
  });

  it('derives generic Split compatibility and backend sharing from resolved capabilities', () => {
    const registry = createPanelTargetRegistry();
    const base = context();
    const agent = registry.resolve(stored('agent-session', { workspaceId: 'workspace-1', sessionId: 'session-1' }), base);
    if (agent.status !== 'resolved') throw new Error(agent.reason);
    const other = context({
      craftId: 'craft-2',
      crafts: { 'craft-2': { workspaceId: 'workspace-2', allowedPluginTargets: [] } },
      workspaces: { 'workspace-2': { ...workspace, id: 'workspace-2', locations: { ...workspace.locations, forms: '/workspaces/workspace-2/forms' } } },
      redirectGuards: { ...base.redirectGuards, 'forms:workspace-2': { deliveryUrl: 'https://dashboard.example.test/guard/forms-2', upstreamOrigin: 'https://vk.example.test' } },
    });
    const compatible = findSplitCompatibleTargets(agent, 'craft-1', [
      { craftId: 'craft-2', target: stored('forms', { workspaceId: 'workspace-2' }) },
      { craftId: 'craft-1', target: stored('terminal', { workspaceId: 'workspace-1', terminalId: 'terminal-1' }) },
      { craftId: 'craft-2', target: stored('forms', { workspaceId: 'workspace-1' }) },
      { craftId: 'missing', target: stored('forms', { workspaceId: 'workspace-1' }) },
    ], (craftId) => craftId === 'craft-1' ? base : craftId === 'craft-2' ? other : null, registry);
    expect(compatible.map((item) => item.craftId)).toEqual(['craft-1', 'craft-2']);
    expect(compatible.every((item) => item.resolved.splitClass === 'workspace-tool')).toBe(true);
  });

  it('fails closed when a trusted custom definition returns malformed output or throws', () => {
    const registry = createPanelTargetRegistry({
      customDefinitions: [{ kind: 'broken', version: 1, parse: () => ({}), migrate: vi.fn(), resolve: () => ({ bad: true }) as never }],
    });
    expect(registry.resolve(stored('broken', {}), context())).toMatchObject({ reason: 'invalid-resolver-result' });
    expect(() => createPanelTargetRegistry({ customDefinitions: [{ kind: 'code', version: 1, parse: () => ({}), migrate: () => ({}), resolve: () => null }] }))
      .toThrow('Duplicate Panel target definition');
    const throwing = createPanelTargetRegistry({ customDefinitions: [{ kind: 'throwing', version: 1, parse: () => ({}), migrate: () => null, resolve: () => { throw new Error('resolver failed'); }, validateResolved: () => true }] });
    expect(throwing.resolve(stored('throwing', {}), context())).toMatchObject({ reason: 'resolver-failed' });
    const throwingValidator = createPanelTargetRegistry({ customDefinitions: [{ kind: 'throwing-validator', version: 1, parse: () => ({}), migrate: () => null, resolve: () => createPanelTargetRegistry().resolve(stored('custom-url', { url: 'https://safe.test' }), context()) as never, validateResolved: () => { throw new Error('validator failed'); } }] });
    expect(() => throwingValidator.resolve(stored('throwing-validator', {}), context())).not.toThrow();
    expect(throwingValidator.resolve(stored('throwing-validator', {}), context())).toMatchObject({ reason: 'invalid-resolver-result' });
  });

  it('semantically rejects unsafe, inconsistent, or identity-forged custom resolver output', () => {
    const base = createPanelTargetRegistry().resolve(stored('custom-url', { url: 'https://safe.example.test' }), context());
    if (base.status !== 'resolved') throw new Error(base.reason);
    const { status: _status, target: _target, ...trusted } = base;
    const registry = (overrides: Record<string, unknown>) => createPanelTargetRegistry({ customDefinitions: [{
      kind: 'custom-definition', version: 1,
      parse: (value) => value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? { id: value.id } : null,
      migrate: () => null,
      resolve: () => ({ ...trusted, canonicalPayload: { id: 'one' }, equivalenceIdentity: 'custom-definition\0one', ...overrides }) as never,
      validateResolved: (value, resolved) => resolved.equivalenceIdentity === `custom-definition\0${value.id}`,
    }] });
    const target = stored('custom-definition', { id: 'one' });
    expect(registry({ canonicalLocation: 'javascript:alert(1)' }).resolve(target, context())).toMatchObject({ reason: 'invalid-resolver-result' });
    expect(registry({ capabilityPolicy: { ...trusted.capabilityPolicy, sandbox: 'allow-scripts allow-same-origin' } }).resolve(target, context())).toMatchObject({ reason: 'invalid-resolver-result' });
    expect(registry({ equivalenceIdentity: 'custom-definition\0other' }).resolve(target, context())).toMatchObject({ reason: 'invalid-resolver-result' });
    expect(registry({ effectiveProvenance: 'installed-plugin', runtimeClass: 'retained' }).resolve(target, context())).toMatchObject({ reason: 'invalid-resolver-result' });
    const ambient = createPanelTargetRegistry().resolve(stored('code', { workspaceId: 'workspace-1' }), context());
    if (ambient.status !== 'resolved') throw new Error(ambient.reason);
    expect(registry({ canonicalLocation: ambient.canonicalLocation, effectiveProvenance: ambient.effectiveProvenance, capabilityPolicy: ambient.capabilityPolicy, runtimeClass: 'retained', splitClass: 'workspace-tool' }).resolve(target, context()))
      .toMatchObject({ reason: 'invalid-resolver-result' });
  });
});

describe('approved migration classification boundary', () => {
  it('derives stored legacy targets only from audited stable identities', () => {
    expect(getLegacyStoredPanelTarget({ view: { id: 'code', url: 'https://attacker.invalid/path' }, workspaceId: 'workspace-1' }))
      .toEqual(stored('code', { workspaceId: 'workspace-1', folderIntent: 'workspace-root' }));
    expect(getLegacyStoredPanelTarget({ view: { id: 'docs', url: 'https://docs.example.test/path' }, workspaceId: 'workspace-1' }))
      .toEqual(stored('custom-url', { url: 'https://docs.example.test/path' }));
    expect(getLegacyStoredPanelTarget({ view: { id: 'agent', url: '/legacy-agent-without-session-id' }, workspaceId: 'workspace-1' }))
      .toBeNull();
    expect(getLegacyStoredPanelTarget({ view: { id: 'unsafe', url: 'https://user:password@example.test' }, workspaceId: 'workspace-1' }))
      .toBeNull();
  });

  it.each([
    [{ groupId: 'tg_home', view: { id: 'x', url: 'https://example.test' } }, 'homepage-representation'],
    [{ groupId: 'craft', view: { id: 'tab_overview', url: 'https://example.test' } }, 'homepage-representation'],
    [{ groupId: 'craft', view: { id: 'x', url: 'internal://spaces-overview' } }, 'homepage-representation'],
    [{ groupId: 'craft', view: { id: 'x', url: '/x', ephemeral: { kind: 'craft-surface' } } }, 'ephemeral-plugin-placeholder'],
  ])('preserves skipped classification %#', (input, reason) => {
    expect(classifyLegacyPanelRepresentation(input)).toEqual({ outcome: 'skip', reason });
  });

  it.each([[[]], [['agent']], [['agent', 'agent']], [['agent', 'code', 'forms']]])('rejects pair cardinality %j', (tabIds) => {
    expect(classifyLegacyPanelRepresentation({ groupId: 'craft', view: { id: 'pair', url: '' }, pair: { id: 'pair', tabIds }, views: [] }))
      .toEqual({ outcome: 'pair', reason: 'pair-cardinality', targets: [], diagnostics: tabIds.map((tabId) => ({ tabId, status: 'invalid', reason: 'pair-cardinality' })) });
  });

  it('audits ordered production ViewPair members and gates topology on two resolved targets', () => {
    const agent = stored('agent-session', { workspaceId: 'workspace-1', sessionId: 'session-1' });
    const input = {
      groupId: 'craft', view: { id: 'pair', url: '' }, pair: { id: 'agent+missing', tabIds: ['agent', 'missing'] },
      views: [{ id: 'agent', title: 'Agent', url: '/agent' }], resolveMember: () => agent,
    };
    expect(classifyLegacyPanelRepresentation(input)).toEqual({
      outcome: 'pair', targets: [agent], diagnostics: [{ tabId: 'agent', status: 'resolved' }, { tabId: 'missing', status: 'missing', reason: 'missing-view' }],
    });
    const code = stored('code', { workspaceId: 'workspace-1' });
    expect(classifyLegacyPanelRepresentation({ ...input, pair: { id: 'agent+code', tabIds: ['agent', 'code'] }, views: [...input.views, { id: 'code', title: 'Code', url: '/code' }], resolveMember: (view) => view.id === 'agent' ? agent : code }))
      .toMatchObject({ outcome: 'pair', targets: [agent, code], topology: { pairId: 'agent+code', memberIndexes: [0, 1] } });
  });

  it('diagnoses malformed, skipped, and unresolvable pair members independently', () => {
    expect(classifyLegacyPanelRepresentation({ groupId: 'craft', view: { id: 'pair', url: '' }, pair: { id: 'bad+home', tabIds: ['bad', 'home'] }, views: [{ id: 'bad', title: 42, url: '/bad' }, { id: 'home', title: 'Home', url: 'internal://spaces-overview' }] }))
      .toMatchObject({ diagnostics: [{ tabId: 'bad', status: 'malformed', reason: 'malformed-view' }, { tabId: 'home', status: 'skipped', reason: 'homepage-representation' }] });
    expect(classifyLegacyPanelRepresentation({ groupId: 'craft', view: { id: 'pair', url: '' }, pair: { id: 'a+b', tabIds: ['a', 'b'] }, views: [{ id: 'a', title: 'A', url: '/a' }, { id: 'b', title: 'B', url: '/b' }], resolveMember: () => null }))
      .toMatchObject({ diagnostics: [{ status: 'unresolvable' }, { status: 'unresolvable' }] });
    expect(classifyLegacyPanelRepresentation({ groupId: 'craft', view: { id: 'pair', url: '' }, pair: { id: 'a+b', tabIds: ['a', 'b'] }, views: [{ id: 'a', title: 'A', url: '/a' }, { id: 'b', title: 'B', url: '/b' }], resolveMember: () => { throw new Error('resolution failed'); } }))
      .toMatchObject({ diagnostics: [{ status: 'unresolvable' }, { status: 'unresolvable' }] });
  });
});
