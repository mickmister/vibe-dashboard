/* eslint-disable formatjs/no-literal-string-in-object -- contract fixtures are not UI copy */
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_PRODUCER_INVENTORY,
  PANEL_TARGET_SCHEMA_VERSION,
  classifyLegacyRepresentation,
  classifyLegacyVoyage,
  findCompatibleSplitTargets,
  parsePanelTarget,
  reconstructGeneratedSurface,
  resolvePanelTarget,
  type CapabilityDescriptor,
  type LegacyRepresentation,
  type TrustedDefinition,
  type TrustedTargetRegistry,
} from './targetRegistry';

const builtInCapabilities: CapabilityDescriptor = {
  sandbox: ['allow-scripts', 'allow-same-origin'],
  clipboardRead: true,
  clipboardWrite: true,
  sameOrigin: true,
  navigation: 'resolved-origin',
};
const pluginCapabilities: CapabilityDescriptor = {
  sandbox: ['allow-scripts'],
  clipboardRead: false,
  clipboardWrite: false,
  sameOrigin: false,
  navigation: 'resolved-origin',
};

function definition(input: Partial<ReturnType<TrustedDefinition['resolve']>> & { key: string; pluginId?: string }): TrustedDefinition {
  return {
    ...(input.pluginId ? { pluginId: input.pluginId } : {}),
    resolve: (context) => ({
      rendererKey: input.rendererKey ?? `${input.key}-renderer`,
      payload: input.payload ?? { workspaceId: context.workspaceId },
      provenance: input.provenance ?? (input.pluginId ? `installed-plugin:${input.pluginId}` : 'built-in'),
      capabilities: input.capabilities ?? (input.pluginId ? pluginCapabilities : builtInCapabilities),
      runtime: input.runtime ?? { kind: 'leaseable-runtime' },
      splitCompatibility: input.splitCompatibility ?? ['workbench'],
      equivalenceInputs: input.equivalenceInputs ?? [input.key, context.craftId],
      sharingInputs: input.sharingInputs ?? [input.key, context.workspaceId ?? 'installation'],
    }),
  };
}

function createRegistry(): TrustedTargetRegistry {
  return {
    crafts: {
      current: { workspaceId: 'workspace-1', allowedScopes: ['builtin/agent', 'builtin/code', 'builtin/beads', 'builtin/forms', 'plugin.preview/run-configs', 'plugin.docs/site', 'plugin.docs/help', 'plugin.unsafe/tool', 'custom-url'] },
      other: { workspaceId: 'workspace-2', allowedScopes: ['builtin/agent', 'builtin/code', 'builtin/forms', 'custom-url'] },
      restricted: { workspaceId: 'workspace-1', allowedScopes: ['builtin/agent'] },
    },
    workspaces: {
      'workspace-1': { containerRef: '/current/repo', available: true },
      'workspace-2': { containerRef: '/other/repo', available: true },
    },
    surfaces: {
      'builtin/agent': {
        ...definition({ key: 'agent', equivalenceInputs: ['agent', 'workspace-1'], sharingInputs: ['vk', 'workspace-1'] }),
        resolve: (context) => ({ ...definition({ key: 'agent' }).resolve(context), payload: { url: `/workspaces/${context.workspaceId}` }, equivalenceInputs: ['agent', context.workspaceId!], sharingInputs: ['vk', context.workspaceId!] }),
      },
      'builtin/code': {
        resolve: (context) => ({ ...definition({ key: 'code' }).resolve(context), rendererKey: 'code-iframe', payload: { url: `/?folder=${encodeURIComponent(context.workspace!.containerRef)}` }, equivalenceInputs: ['code', context.workspaceId!], sharingInputs: ['code', context.workspaceId!] }),
      },
      'builtin/beads': definition({ key: 'beads', sharingInputs: ['beads', 'installation'] }),
      'builtin/forms': definition({ key: 'forms' }),
      'plugin.preview/run-configs': definition({ key: 'preview', pluginId: 'plugin.preview', rendererKey: 'plugin-react:plugin.preview/run-configs', runtime: { kind: 'recreatable-transient-runtime', continuity: 'React local state resets; backend state remains shared' } }),
      'plugin.docs/site': definition({ key: 'docs', pluginId: 'plugin.docs', rendererKey: 'plugin-iframe:plugin.docs/site', splitCompatibility: ['reference'] }),
      'plugin.unsafe/tool': definition({ key: 'unsafe', pluginId: 'plugin.unsafe', runtime: { kind: 'unsupported', reason: 'no stable host contract' } }),
    },
    internalRoutes: {
      'plugin.docs/help': {
        ...definition({ key: 'help', pluginId: 'plugin.docs', rendererKey: 'plugin-internal:plugin.docs/help' }),
        routeKey: 'help',
        routePath: '/help',
        allowedParams: ['topic'],
        resolve: (context) => ({ ...definition({ key: 'help', pluginId: 'plugin.docs' }).resolve(context), rendererKey: 'plugin-internal:plugin.docs/help', payload: { url: `/plugins/plugin.docs/help?topic=${encodeURIComponent(context.params?.topic ?? '')}` } }),
      },
    },
    installedPlugins: new Set(['plugin.preview', 'plugin.docs', 'plugin.unsafe', 'plugin.factory']),
    factories: { 'plugin.factory/open': { surfaceKeys: { agent: 'builtin/agent', code: 'builtin/code' } } },
    customUrl: {
      resolve: ({ requestedUrl, craftId }) => {
        const url = new URL(requestedUrl!);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
        return {
          rendererKey: 'custom-url-iframe', payload: { url: url.href }, provenance: 'untrusted-custom-url',
          capabilities: { sandbox: ['allow-scripts'], clipboardRead: false, clipboardWrite: false, sameOrigin: false, navigation: 'any-http-origin' },
          runtime: url.hostname === 'no-split.example' ? { kind: 'unsupported', reason: 'custom target denies Split View' } : { kind: 'leaseable-runtime' },
          splitCompatibility: url.hostname === 'no-split.example' ? [] : ['reference'],
          equivalenceInputs: ['url', url.href], sharingInputs: ['url', url.origin, craftId],
        };
      },
    },
  };
}

describe('versioned Panel target parsing', () => {
  it('strictly parses all four durable families and canonicalizes route params', () => {
    const values = [
      { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/agent' },
      { version: 1, kind: 'plugin-surface', pluginId: 'plugin.docs', surfaceKey: 'site' },
      { version: 1, kind: 'plugin-internal-route', pluginId: 'plugin.docs', routeKey: 'help', params: { topic: 'api' } },
      { version: 1, kind: 'custom-url', requestedUrl: 'https://docs.example/path' },
    ];
    for (const value of values) expect(parsePanelTarget(value)).toEqual(value);
    expect(PANEL_TARGET_SCHEMA_VERSION).toBe(1);
  });

  it.each([
    null,
    { version: 2, kind: 'custom-url', requestedUrl: 'https://example.test' },
    { version: 1, kind: 'unknown' },
    { version: 1, kind: 'custom-url', requestedUrl: 'https://example.test', provenance: 'trusted' },
    { version: 1, kind: 'plugin-internal-route', pluginId: 'plugin.docs', routeKey: '../help', params: {} },
    { version: 1, kind: 'plugin-internal-route', pluginId: 'plugin.docs', routeKey: 'help', params: { topic: 1 } },
  ])('rejects malformed or authority-bearing input %#', (value) => expect(parsePanelTarget(value)).toBeNull());
});

describe('unified trusted resolution boundary', () => {
  it('derives every effective field and ignores stale built-in paths', () => {
    const registry = createRegistry();
    const target = { version: 1 as const, kind: 'workspace-surface' as const, workspaceId: 'workspace-1', surfaceKey: 'builtin/code' };
    expect(resolvePanelTarget(target, { craftId: 'current' }, registry)).toMatchObject({
      ok: true, target, rendererKey: 'code-iframe', payload: { url: '/?folder=%2Fcurrent%2Frepo' },
      provenance: 'built-in', capabilities: builtInCapabilities, runtime: { kind: 'leaseable-runtime' },
      splitCompatibility: ['workbench'], equivalenceKey: 'code:workspace-1', backendSharingKey: 'code:workspace-1',
    });
  });

  it('requires authoritative owner Craft, Workspace relation, and target scope', () => {
    const registry = createRegistry();
    const code = { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/code' };
    expect(resolvePanelTarget(code, { craftId: 'missing' }, registry)).toEqual({ ok: false, reason: 'craft-unavailable' });
    expect(resolvePanelTarget(code, { craftId: 'other' }, registry)).toEqual({ ok: false, reason: 'workspace-owner-mismatch' });
    expect(resolvePanelTarget(code, { craftId: 'restricted' }, registry)).toEqual({ ok: false, reason: 'target-scope-denied' });
  });

  it('catches malformed URLs and all resolver failures as typed recovery', () => {
    const registry = createRegistry();
    expect(resolvePanelTarget({ version: 1, kind: 'custom-url', requestedUrl: 'not a URL' }, { craftId: 'current' }, registry)).toEqual({ ok: false, reason: 'custom-url-rejected' });
    registry.surfaces['builtin/forms'] = { resolve: vi.fn(() => { throw new Error('resolver exploded'); }) };
    expect(resolvePanelTarget({ version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/forms' }, { craftId: 'current' }, registry)).toEqual({ ok: false, reason: 'resolver-failed' });
    registry.surfaces['builtin/forms'] = { resolve: () => ({ rendererKey: '', payload: {}, provenance: 'built-in', capabilities: builtInCapabilities, runtime: { kind: 'leaseable-runtime' }, splitCompatibility: [], equivalenceInputs: [], sharingInputs: [] }) };
    expect(resolvePanelTarget({ version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/forms' }, { craftId: 'current' }, registry)).toEqual({ ok: false, reason: 'invalid-resolver-result' });
  });

  it('reflects current policy tightening and custom Split denial without kind defaults', () => {
    const registry = createRegistry();
    const docs = { version: 1, kind: 'plugin-surface', pluginId: 'plugin.docs', surfaceKey: 'site' };
    expect(resolvePanelTarget(docs, { craftId: 'current' }, registry)).toMatchObject({ capabilities: pluginCapabilities });
    registry.surfaces['plugin.docs/site'] = definition({ key: 'docs', pluginId: 'plugin.docs', capabilities: { ...pluginCapabilities, navigation: 'none' } });
    expect(resolvePanelTarget(docs, { craftId: 'current' }, registry)).toMatchObject({ capabilities: { navigation: 'none' } });
    expect(resolvePanelTarget({ version: 1, kind: 'custom-url', requestedUrl: 'https://no-split.example' }, { craftId: 'current' }, registry)).toMatchObject({ runtime: { kind: 'unsupported', reason: 'custom target denies Split View' }, splitCompatibility: [] });
  });

  it('resolves internal routes only through installed route definitions and allowlisted params', () => {
    const registry = createRegistry();
    const route = { version: 1, kind: 'plugin-internal-route', pluginId: 'plugin.docs', routeKey: 'help', params: { topic: 'api' } };
    expect(resolvePanelTarget(route, { craftId: 'current' }, registry)).toMatchObject({ ok: true, rendererKey: 'plugin-internal:plugin.docs/help', payload: { url: '/plugins/plugin.docs/help?topic=api' } });
    expect(resolvePanelTarget({ ...route, params: { redirect: 'https://evil.test' } }, { craftId: 'current' }, registry)).toEqual({ ok: false, reason: 'invalid-route-params' });
    delete registry.internalRoutes['plugin.docs/help'];
    expect(resolvePanelTarget(route, { craftId: 'current' }, registry)).toEqual({ ok: false, reason: 'internal-route-unavailable' });
    expect(resolvePanelTarget({ version: 1, kind: 'custom-url', requestedUrl: 'internal://plugin.docs/help' }, { craftId: 'current' }, registry)).toEqual({ ok: false, reason: 'custom-url-rejected' });
    registry.installedPlugins.delete('plugin.docs');
    expect(resolvePanelTarget(route, { craftId: 'current' }, registry)).toEqual({ ok: false, reason: 'plugin-unavailable' });
  });

  it('uses definition compatibility with same-Craft default and permitted cross-Craft results', () => {
    const registry = createRegistry();
    const invoking = resolvePanelTarget({ version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/agent' }, { craftId: 'current' }, registry);
    if (!invoking.ok) throw new Error(invoking.reason);
    const candidates = [
      { craftId: 'other', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-2', surfaceKey: 'builtin/code' } },
      { craftId: 'current', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/forms' } },
      { craftId: 'current', target: { version: 1, kind: 'plugin-surface', pluginId: 'plugin.unsafe', surfaceKey: 'tool' } },
    ] as const;
    expect(findCompatibleSplitTargets(invoking, 'current', candidates, registry).map(({ craftId }) => craftId)).toEqual(['current', 'other']);
  });
});

describe('legacy migration inventory', () => {
  it('locks all audited producer families', () => {
    expect(CURRENT_PRODUCER_INVENTORY).toHaveLength(13);
  });

  it('always skips ephemeral placeholders but reconstructs from current definitions separately', () => {
    const registry = createRegistry();
    const ephemeral: LegacyRepresentation = { kind: 'view', craftId: 'current', groupId: 'craft', workspaceId: 'workspace-1', view: { id: 'craft-surface:current:preview', title: 'Preview', url: 'https://attacker.invalid', ephemeral: { kind: 'craft-surface', pluginId: 'plugin.preview', surfaceKey: 'forged', sourceKey: 'run-configs' } } };
    expect(classifyLegacyRepresentation(ephemeral, registry)).toEqual({ outcome: 'skip', reason: 'ephemeral-plugin-placeholder' });
    registry.installedPlugins.delete('plugin.preview');
    expect(classifyLegacyRepresentation(ephemeral, registry)).toEqual({ outcome: 'skip', reason: 'ephemeral-plugin-placeholder' });
    registry.installedPlugins.add('plugin.preview');
    expect(reconstructGeneratedSurface('current', 'plugin.preview', 'run-configs', registry)).toMatchObject({ ok: true, rendererKey: 'plugin-react:plugin.preview/run-configs' });
  });

  it.each([
    ['Agent', 'agent', '/stale-agent', 'builtin/agent'],
    ['Code', 'code', '/?folder=/stale', 'builtin/code'],
    ['Beads', 'beads', '/stale-beads', 'builtin/beads'],
    ['Forms', 'forms', '/stale-forms', 'builtin/forms'],
  ])('maps generated %s through stable Workspace identity', (_label, id, url, surfaceKey) => {
    expect(classifyLegacyRepresentation({ kind: 'view', craftId: 'current', groupId: 'craft', workspaceId: 'workspace-1', view: { id, title: id, url } }, createRegistry())).toEqual({ outcome: 'panel', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey } });
  });

  it('classifies custom URL, internal route, and temporary action producers distinctly', () => {
    const registry = createRegistry();
    expect(classifyLegacyRepresentation({ kind: 'view', craftId: 'current', groupId: 'craft', view: { id: 'docs', title: 'Docs', url: 'https://docs.example.test' } }, registry)).toMatchObject({ outcome: 'panel', target: { kind: 'custom-url' } });
    expect(classifyLegacyRepresentation({ kind: 'view', craftId: 'current', groupId: 'craft', view: { id: 'help', title: 'Help', url: 'internal://plugins/plugin.docs/help?topic=api' } }, registry)).toEqual({ outcome: 'panel', target: { version: 1, kind: 'plugin-internal-route', pluginId: 'plugin.docs', routeKey: 'help', params: { topic: 'api' } } });
    expect(classifyLegacyRepresentation({ kind: 'temporary-create-workspace', craftId: 'pending' }, registry)).toEqual({ outcome: 'skip', reason: 'temporary-create-workspace' });
  });

  it('derives internal route identity from real persisted View URLs with production normalization', () => {
    const registry = createRegistry();
    const classify = (url: string, currentRegistry = registry) => classifyLegacyRepresentation({ kind: 'view', craftId: 'current', groupId: 'craft', view: { id: 'help', title: 'Help', url, pinned: true } }, currentRegistry);
    expect(classify('internal://plugins/plugin%2Edocs/help?topic=API%20design')).toEqual({ outcome: 'panel', target: { version: 1, kind: 'plugin-internal-route', pluginId: 'plugin.docs', routeKey: 'help', params: { topic: 'API design' } } });
    expect(classify('internal://plugins/plugin.docs/../help')).toEqual({ outcome: 'quarantine', reason: 'malformed-internal-route' });
    expect(classify('internal://plugins/plugin.docs/help?topic=one&topic=two')).toEqual({ outcome: 'quarantine', reason: 'malformed-internal-route-params' });
    expect(classify('internal://plugins/plugin.docs/help?topic=%E0%A4%A')).toEqual({ outcome: 'quarantine', reason: 'malformed-internal-route-params' });
    expect(classify('internal://plugins/plugin.docs/help?topic=one?topic=two')).toEqual({ outcome: 'quarantine', reason: 'malformed-internal-route' });
    expect(classify('internal://plugins/plugin.docs/help?redirect=evil')).toEqual({ outcome: 'quarantine', reason: 'invalid-route-params' });
    expect(classify('internal://plugins/removed/help')).toEqual({ outcome: 'quarantine', reason: 'plugin-unavailable' });
    expect(classify('internal://plugins/plugin.docs/missing')).toEqual({ outcome: 'quarantine', reason: 'internal-route-unavailable' });
    expect(classify('internal://unknown')).toEqual({ outcome: 'quarantine', reason: 'unmatched-internal-route' });

    registry.internalRoutes['plugin.docs/help-copy'] = {
      ...registry.internalRoutes['plugin.docs/help']!,
      routeKey: 'help-copy',
    };
    expect(classify('internal://plugins/plugin.docs/help')).toEqual({ outcome: 'quarantine', reason: 'ambiguous-internal-route' });
  });

  it.each([
    ['tg_home', { groupId: 'tg_home', id: 'ordinary', url: 'https://example.test' }],
    ['tab_overview', { groupId: 'craft', id: 'tab_overview', url: 'https://example.test' }],
    ['internal URL', { groupId: 'craft', id: 'ordinary', url: 'internal://spaces-overview' }],
  ])('skips homepage representation identified by %s', (_label, value) => {
    expect(classifyLegacyRepresentation({ kind: 'view', craftId: 'current', groupId: value.groupId, view: { id: value.id, title: 'View', url: value.url } }, createRegistry())).toEqual({ outcome: 'skip', reason: 'homepage-representation' });
  });

  it('balances mixed and homepage-only Voyages and omits only the latter', () => {
    const homepage: LegacyRepresentation = { kind: 'view', craftId: 'current', groupId: 'tg_home', view: { id: 'ordinary', title: 'Home', url: 'https://example.test' } };
    const code: LegacyRepresentation = { kind: 'view', craftId: 'current', groupId: 'craft', workspaceId: 'workspace-1', view: { id: 'code', title: 'Code', url: '/?folder=/stale' } };
    expect(classifyLegacyVoyage([homepage], createRegistry())).toMatchObject({ counts: { skip: 1 }, omitVoyage: true });
    expect(classifyLegacyVoyage([homepage, code], createRegistry())).toMatchObject({ counts: { skip: 1, panel: 1 }, omitVoyage: false });
  });

  it('maps factories from manifest identity, not expanded URL', () => {
    expect(classifyLegacyRepresentation({ kind: 'factory-view', craftId: 'current', groupId: 'craft', workspaceId: 'workspace-1', pluginId: 'plugin.factory', factoryKey: 'open', surfaceKey: 'code', expandedUrl: 'https://attacker.invalid' }, createRegistry())).toEqual({ outcome: 'panel', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/code' } });
  });

  it('resolves production-shaped pair tabIds independently and emits topology only when both succeed', () => {
    const views = [{ id: 'agent', title: 'Agent', url: '/stale-agent' }, { id: 'code', title: 'Code', url: '/stale-code' }];
    const validPair: LegacyRepresentation = { kind: 'pair', craftId: 'current', groupId: 'craft', workspaceId: 'workspace-1', pair: { id: 'agent+code', tabIds: ['agent', 'code'] }, views };
    const valid = classifyLegacyRepresentation(validPair, createRegistry());
    expect(valid).toMatchObject({ outcome: 'pair', targets: [{ surfaceKey: 'builtin/agent' }, { surfaceKey: 'builtin/code' }], diagnostics: [{ viewId: 'agent', outcome: 'panel' }, { viewId: 'code', outcome: 'panel' }], topology: { pairId: 'agent+code', memberIndexes: [0, 1] } });

    const partial = classifyLegacyRepresentation({ ...validPair, pair: { id: 'partial', tabIds: ['agent', 'bad'] }, views: [...views, { id: 'bad', title: 'Bad', url: 'not a URL' }] }, createRegistry());
    expect(partial).toMatchObject({ outcome: 'pair', targets: [{ surfaceKey: 'builtin/agent' }], diagnostics: [{ viewId: 'agent', outcome: 'panel' }, { viewId: 'bad', outcome: 'quarantine', reason: 'custom-url-rejected' }] });
    expect(partial).not.toHaveProperty('topology');
  });

  it('diagnoses missing first and second pair references in original order', () => {
    const registry = createRegistry();
    const views = [{ id: 'agent', title: 'Agent', url: '/agent' }];
    const classify = (tabIds: string[]) => classifyLegacyRepresentation({ kind: 'pair', craftId: 'current', groupId: 'craft', workspaceId: 'workspace-1', pair: { id: 'pair', tabIds }, views }, registry);
    expect(classify(['missing', 'agent'])).toMatchObject({ diagnostics: [{ viewId: 'missing', outcome: 'missing', reason: 'missing-view' }, { viewId: 'agent', outcome: 'panel' }] });
    expect(classify(['agent', 'missing'])).toMatchObject({ diagnostics: [{ viewId: 'agent', outcome: 'panel' }, { viewId: 'missing', outcome: 'missing', reason: 'missing-view' }] });
    expect(classify(['missing', 'agent'])).not.toHaveProperty('topology');
  });

  it.each([
    [[], 'pair-cardinality'],
    [['agent'], 'pair-cardinality'],
    [['agent', 'code', 'forms'], 'pair-cardinality'],
    [['agent', 'agent'], 'duplicate-member-id'],
  ])('rejects invalid pair IDs %j', (tabIds, reason) => {
    const result = classifyLegacyRepresentation({ kind: 'pair', craftId: 'current', groupId: 'craft', workspaceId: 'workspace-1', pair: { id: 'pair', tabIds }, views: [{ id: 'agent', title: 'Agent', url: '/agent' }, { id: 'code', title: 'Code', url: '/code' }, { id: 'forms', title: 'Forms', url: '/forms' }] }, createRegistry());
    expect(result).not.toHaveProperty('topology');
    expect(result).toMatchObject({ diagnostics: tabIds.map((viewId) => ({ viewId, outcome: 'invalid', reason })) });
    if (reason === 'pair-cardinality') expect(result).toMatchObject({ reason: 'pair-cardinality' });
    if (tabIds.length === 0) {
      expect(result).toEqual({ outcome: 'pair', reason: 'pair-cardinality', targets: [], diagnostics: [] });
    }
  });

  it('diagnoses a malformed referenced View before target resolution', () => {
    const result = classifyLegacyRepresentation({ kind: 'pair', craftId: 'current', groupId: 'craft', workspaceId: 'workspace-1', pair: { id: 'pair', tabIds: ['agent', 'broken'] }, views: [{ id: 'agent', title: 'Agent', url: '/agent' }, { id: 'broken', title: 42, url: '/broken' }] as unknown as Array<{ id: string; title: string; url: string }> }, createRegistry());
    expect(result).toMatchObject({ diagnostics: [{ viewId: 'agent', outcome: 'panel' }, { viewId: 'broken', outcome: 'malformed', reason: 'malformed-view' }] });
    expect(result).not.toHaveProperty('topology');
  });
});
