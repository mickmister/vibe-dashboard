/* eslint-disable formatjs/no-literal-string-in-object -- contract fixtures are not UI copy */
import { describe, expect, it } from 'vitest';
import {
  PANEL_TARGET_SCHEMA_VERSION,
  CURRENT_PRODUCER_INVENTORY,
  classifyLegacyRepresentation,
  findCompatibleSplitTargets,
  parsePanelTarget,
  resolvePanelTarget,
  type LegacyRepresentation,
  type TrustedTargetRegistry,
} from './targetRegistry';

const registry: TrustedTargetRegistry = {
  crafts: {
    'craft-1': { workspaceId: 'workspace-1' },
    c: { workspaceId: 'workspace-1' },
    current: { workspaceId: 'workspace-1' },
    other: { workspaceId: 'workspace-2' },
  },
  workspaces: {
    'workspace-1': { containerRef: '/current/repo', available: true },
    'workspace-2': { containerRef: '/other/repo', available: true },
  },
  surfaces: {
    'builtin/agent': {
      rendererKey: 'vk-agent-iframe',
      runtime: { kind: 'leaseable-runtime' },
      splitCompatibility: ['workbench'],
      resolve: ({ workspaceId }) => ({ url: `/workspaces/${workspaceId}` }),
      backendSharingKey: ({ workspaceId }) => `vk:${workspaceId}`,
    },
    'builtin/code': {
      rendererKey: 'code-iframe',
      runtime: { kind: 'leaseable-runtime' },
      splitCompatibility: ['workbench'],
      resolve: ({ workspace }) => ({ url: `/?folder=${encodeURIComponent(workspace.containerRef)}` }),
      backendSharingKey: ({ workspaceId }) => `code:${workspaceId}`,
    },
    'builtin/forms': {
      rendererKey: 'forms-iframe',
      runtime: { kind: 'leaseable-runtime' },
      splitCompatibility: ['workbench'],
      resolve: ({ workspaceId }) => ({ url: `/dashboard/forms?workspace=${workspaceId}` }),
      backendSharingKey: ({ workspaceId }) => `forms:${workspaceId}`,
    },
    'builtin/beads': {
      rendererKey: 'beads-iframe',
      runtime: { kind: 'leaseable-runtime' },
      splitCompatibility: ['workbench'],
      resolve: () => ({ url: '/beads' }),
      backendSharingKey: () => 'beads:installation',
    },
    'plugin.preview/run-configs': {
      pluginId: 'plugin.preview',
      rendererKey: 'plugin-react:plugin.preview/run-configs',
      runtime: {
        kind: 'recreatable-transient-runtime',
        continuity: 'recreated React state resets; backend state remains shared',
      },
      splitCompatibility: ['workbench'],
      resolve: ({ workspaceId }) => ({ props: { workspaceId } }),
      backendSharingKey: ({ workspaceId }) => `preview:${workspaceId}`,
    },
    'plugin.docs/site': {
      pluginId: 'plugin.docs',
      rendererKey: 'plugin-iframe:plugin.docs/site',
      runtime: { kind: 'leaseable-runtime' },
      splitCompatibility: ['reference'],
      resolve: () => ({ url: '/plugins/plugin.docs/site' }),
      backendSharingKey: () => 'plugin.docs/site',
    },
    'plugin.unsafe/tool': {
      pluginId: 'plugin.unsafe',
      rendererKey: 'unsupported:plugin.unsafe/tool',
      runtime: { kind: 'unsupported', reason: 'surface has no stable leaseable or recreatable host' },
      splitCompatibility: ['workbench'],
      resolve: () => ({}),
      backendSharingKey: () => 'plugin.unsafe/tool',
    },
  },
  installedPlugins: new Set(['plugin.preview', 'plugin.docs', 'plugin.unsafe']),
  factories: {
    'plugin.factory/open': { surfaceKeys: { agent: 'builtin/agent', code: 'builtin/code' } },
  },
  resolveCustomUrl: (requestedUrl) => {
    const parsed = new URL(requestedUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return {
      payload: { url: parsed.href },
      rendererKey: 'custom-url-iframe',
      provenance: 'untrusted-custom-url',
      capabilities: ['sandboxed-navigation'],
    };
  },
};

describe('versioned Panel target contract', () => {
  it('locks the audited set of currently constructible producer families', () => {
    expect(CURRENT_PRODUCER_INVENTORY).toEqual([
      'vk-agent',
      'code',
      'beads',
      'forms',
      'custom-url-or-preset',
      'plugin-iframe-surface',
      'plugin-internal-route',
      'plugin-react-surface',
      'workspace-factory',
      'pair-placement',
      'spaces-overview-homepage',
      'create-workspace-action',
      'generated-ephemeral-surface',
    ]);
  });
  it('strictly parses every durable v1 target family and rejects malformed or unknown input', () => {
    const targets = [
      { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/agent' },
      { version: 1, kind: 'plugin-surface', craftId: 'craft-1', pluginId: 'plugin.docs', surfaceKey: 'site' },
      { version: 1, kind: 'custom-url', requestedUrl: 'https://docs.example.test/path' },
    ];
    for (const target of targets) expect(parsePanelTarget(target)).toEqual(target);

    for (const invalid of [
      null,
      { version: 2, kind: 'custom-url', requestedUrl: 'https://example.test' },
      { version: 1, kind: 'unknown' },
      { version: 1, kind: 'custom-url', requestedUrl: 'https://example.test', provenance: 'trusted' },
      { version: 1, kind: 'workspace-surface', workspaceId: '', surfaceKey: 'builtin/code' },
      { version: 1, kind: 'plugin-surface', craftId: 'c', pluginId: 'p', surfaceKey: '../escape' },
    ]) expect(parsePanelTarget(invalid)).toBeNull();
    expect(PANEL_TARGET_SCHEMA_VERSION).toBe(1);
  });

  it('derives renderer, URL/path, provenance, capabilities, equivalence, and sharing from trusted state', () => {
    const stored = {
      version: 1 as const,
      kind: 'workspace-surface' as const,
      workspaceId: 'workspace-1',
      surfaceKey: 'builtin/code',
    };
    expect(resolvePanelTarget(stored, registry)).toEqual({
      ok: true,
      target: stored,
      payload: { url: '/?folder=%2Fcurrent%2Frepo' },
      rendererKey: 'code-iframe',
      provenance: 'built-in',
      capabilities: ['same-origin', 'clipboard'],
      equivalenceKey: 'workspace-surface:workspace-1:builtin/code',
      backendSharingKey: 'code:workspace-1',
      runtime: { kind: 'leaseable-runtime' },
      splitCompatibility: ['workbench'],
    });
  });

  it('fails closed for unavailable workspaces, removed plugins, unknown surfaces, and unsafe URLs', () => {
    expect(resolvePanelTarget({ version: 1, kind: 'workspace-surface', workspaceId: 'missing', surfaceKey: 'builtin/code' }, registry)).toEqual({ ok: false, reason: 'workspace-unavailable' });
    expect(resolvePanelTarget({ version: 1, kind: 'plugin-surface', craftId: 'c', pluginId: 'removed', surfaceKey: 'view' }, registry)).toEqual({ ok: false, reason: 'plugin-unavailable' });
    expect(resolvePanelTarget({ version: 1, kind: 'plugin-surface', craftId: 'c', pluginId: 'plugin.docs', surfaceKey: 'removed' }, registry)).toEqual({ ok: false, reason: 'surface-unavailable' });
    expect(resolvePanelTarget({ version: 1, kind: 'plugin-surface', craftId: 'missing', pluginId: 'plugin.docs', surfaceKey: 'site' }, registry)).toEqual({ ok: false, reason: 'craft-unavailable' });
    expect(resolvePanelTarget({ version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'plugin.docs/site' }, registry)).toEqual({ ok: false, reason: 'surface-unavailable' });
    expect(resolvePanelTarget({ version: 1, kind: 'custom-url', requestedUrl: 'javascript:alert(1)' }, registry)).toEqual({ ok: false, reason: 'custom-url-rejected' });
  });

  it('takes plugin renderer and Split runtime semantics only from installed definitions', () => {
    expect(resolvePanelTarget({ version: 1, kind: 'plugin-surface', craftId: 'craft-1', pluginId: 'plugin.preview', surfaceKey: 'run-configs' }, registry)).toMatchObject({
      ok: true,
      rendererKey: 'plugin-react:plugin.preview/run-configs',
      provenance: 'installed-plugin:plugin.preview',
      runtime: {
        kind: 'recreatable-transient-runtime',
        continuity: 'recreated React state resets; backend state remains shared',
      },
    });
    expect(resolvePanelTarget({ version: 1, kind: 'plugin-surface', craftId: 'craft-1', pluginId: 'plugin.unsafe', surfaceKey: 'tool' }, registry)).toMatchObject({
      ok: true,
      runtime: { kind: 'unsupported', reason: 'surface has no stable leaseable or recreatable host' },
    });
  });

  it('classifies Split View capability explicitly and orders compatible targets same-Craft first', () => {
    const candidates = [
      { craftId: 'other', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-2', surfaceKey: 'builtin/code' } },
      { craftId: 'current', target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/forms' } },
      { craftId: 'current', target: { version: 1, kind: 'plugin-surface', craftId: 'current', pluginId: 'plugin.unsafe', surfaceKey: 'tool' } },
    ] as const;
    const invoking = resolvePanelTarget({ version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/agent' }, registry);
    if (!invoking.ok) throw new Error(invoking.reason);
    expect(findCompatibleSplitTargets(invoking, 'current', candidates, registry).map((item) => item.craftId)).toEqual(['current', 'other']);
  });
});

describe('legacy producer inventory and migration classification', () => {
  const cases: Array<[string, LegacyRepresentation, string]> = [
    ['VK Agent', { kind: 'view', craftId: 'c', workspaceId: 'workspace-1', view: { id: 'agent', title: 'Agent', url: 'https://stale/workspaces/wrong' } }, 'panel'],
    ['Code', { kind: 'view', craftId: 'c', workspaceId: 'workspace-1', view: { id: 'code', title: 'Code', url: 'https://stale/?folder=/wrong' } }, 'panel'],
    ['Beads', { kind: 'view', craftId: 'c', workspaceId: 'workspace-1', view: { id: 'beads', title: 'Beads', url: 'https://stale' } }, 'panel'],
    ['Forms', { kind: 'view', craftId: 'c', workspaceId: 'workspace-1', view: { id: 'forms', title: 'Forms', url: 'https://stale' } }, 'panel'],
    ['plugin iframe', { kind: 'view', craftId: 'c', workspaceId: 'workspace-1', view: { id: 'craft-surface:c:plugin.docs/site', title: 'Docs', url: 'https://stale', ephemeral: { kind: 'craft-surface', pluginId: 'plugin.docs', surfaceKey: 'plugin.docs/site', sourceKey: 'site' } } }, 'panel'],
    ['plugin React', { kind: 'view', craftId: 'c', workspaceId: 'workspace-1', view: { id: 'craft-surface:c:plugin.preview/run-configs', title: 'Preview', url: 'internal://stale', ephemeral: { kind: 'craft-surface', pluginId: 'plugin.preview', surfaceKey: 'plugin.preview/run-configs', sourceKey: 'run-configs' } } }, 'panel'],
    ['custom URL/preset', { kind: 'view', craftId: 'c', view: { id: 'custom', title: 'Docs', url: 'https://docs.example.test' } }, 'panel'],
    ['pair', { kind: 'pair', craftId: 'c', pairId: 'agent+code', viewIds: ['agent', 'code'] }, 'placement-only'],
    ['Spaces Overview', { kind: 'view', craftId: 'home', view: { id: 'tab_overview', title: 'Spaces', url: 'internal://spaces-overview' } }, 'homepage-state'],
    ['Create Workspace', { kind: 'temporary-create-workspace', craftId: 'pending' }, 'skip'],
  ];

  it.each(cases)('%s has one deterministic outcome', (_label, input, outcome) => {
    expect(classifyLegacyRepresentation(input, registry).outcome).toBe(outcome);
  });

  it('uses installed factory identity rather than expanded URL and quarantines unresolved plugin views', () => {
    const withFactory = {
      ...registry,
      installedPlugins: new Set([...registry.installedPlugins, 'plugin.factory']),
    };
    expect(classifyLegacyRepresentation({ kind: 'factory-view', craftId: 'c', workspaceId: 'workspace-1', pluginId: 'plugin.factory', factoryKey: 'open', surfaceKey: 'code', expandedUrl: 'https://attacker.invalid' }, withFactory)).toEqual({
      outcome: 'panel',
      target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/code' },
    });
    expect(classifyLegacyRepresentation({ kind: 'factory-view', craftId: 'c', workspaceId: 'workspace-1', pluginId: 'plugin.factory', factoryKey: 'open', surfaceKey: 'agent', expandedUrl: 'https://attacker.invalid' }, registry)).toEqual({ outcome: 'quarantine', reason: 'factory-unavailable' });
    expect(classifyLegacyRepresentation({ kind: 'view', craftId: 'c', view: { id: 'craft-surface:c:gone/view', title: 'Gone', url: 'https://stale', ephemeral: { kind: 'craft-surface', pluginId: 'gone', surfaceKey: 'gone/view', sourceKey: 'view' } } }, registry)).toEqual({ outcome: 'quarantine', reason: 'plugin-unavailable' });
  });

  it('ignores stale built-in URLs and rejects unavailable workspace identity', () => {
    expect(classifyLegacyRepresentation({ kind: 'view', craftId: 'c', workspaceId: 'workspace-1', view: { id: 'code', title: 'Code', url: 'https://attacker.invalid/?folder=/wrong' } }, registry)).toEqual({
      outcome: 'panel',
      target: { version: 1, kind: 'workspace-surface', workspaceId: 'workspace-1', surfaceKey: 'builtin/code' },
    });
    expect(classifyLegacyRepresentation({ kind: 'view', craftId: 'c', workspaceId: 'missing', view: { id: 'agent', title: 'Agent', url: '/workspaces/missing' } }, registry)).toEqual({
      outcome: 'quarantine',
      reason: 'workspace-unavailable',
    });
  });
});
