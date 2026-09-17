/* eslint-disable formatjs/no-literal-string-in-object -- exact authority fixtures */
import { describe, expect, it, vi } from 'vitest';
import { createEmptyPluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { createPanelTargetRouterAuthoritySnapshot } from '../server/panelTargetRouterAuthority';
import { createProductionPanelTargetAuthorityServices, createProductionPanelTargetContextProvider } from './productionPanelTargetAuthority';

const delivery = (location: string) => ({ location, available: true, factoryKey: 'server-owned-panel', redirectGuard: { deliveryUrl: location, upstreamOrigin: new URL(location, 'https://dashboard.test').origin } });
function pluginSnapshot(allowed = true) {
  const plugins = createEmptyPluginRegistryState();
  plugins.plugins['plugin.docs'] = { id: 'plugin.docs', displayName: 'Docs', version: '1', apiVersion: '1.0.0', registeredAt: 'now', contributions: {} };
  plugins.internalRoutes['plugin.docs/help'] = { pluginId: 'plugin.docs', sourceKey: 'help', key: 'plugin.docs/help', title: 'Help', path: '/help', urlTemplate: 'https://plugin.test/help', allowedParams: [] };
  plugins.tabGroupFactories['plugin.docs/workspace'] = { pluginId: 'plugin.docs', sourceKey: 'workspace', key: 'plugin.docs/workspace', title: 'Workspace', description: 'Workspace', launchMode: 'vk-workspace',
    allowedPluginTargets: allowed ? ['plugin.docs/help'] : [], workspaceComposition: { tabs: [{ key: 'help', title: 'Help', urlTemplate: 'internal://plugins/plugin.docs/help' }] } };
  return plugins;
}
function client(input: { archived?: boolean; includeBackend?: boolean; mismatchedPreview?: boolean } = {}) {
  const panelTargets = { overview: delivery('https://dashboard.test/workspace'), code: delivery('https://dashboard.test/?folder=/trusted'), changes: delivery('https://dashboard.test/changes'), beads: delivery('https://dashboard.test/beads'), forms: delivery('https://dashboard.test/forms') };
  return {
    getWorkspaces: vi.fn(async () => [{ id: 'workspace-1', archived: input.archived ?? false, agent_working_dir: '/trusted', panel_targets: panelTargets }] as never),
    getWorkspaceRepos: vi.fn(async () => [{ id: 'repo-1' }] as never),
    getSessions: vi.fn(async () => input.includeBackend === false ? [] : [{ id: 'session-1', workspace_id: 'workspace-1',
      panel_target: delivery('https://dashboard.test/sessions/session-1'),
      terminal_target: { ...delivery('https://dashboard.test/terminals/terminal-1'), terminalId: 'terminal-1', allowedCraftIds: ['craft-1'], available: true },
    }] as never),
    getRunConfigs: vi.fn(async () => ({ run_configs: [], preview_slots: [], preview_url_parts: input.includeBackend === false ? [] : [{ previewSlotId: 'preview-1', customerSlug: 'customer', factoryKey: 'preview-slot', allowedCraftIds: ['craft-1'], redirectGuard: { deliveryUrl: 'https://dashboard.test/preview/preview-1', upstreamOrigin: 'https://preview.test' } }] }) as never),
    getPreviewSlotUrl: vi.fn(async () => ({ previewSlotId: input.mismatchedPreview ? 'other' : 'preview-1', workspaceToken: 'token', repoSlug: 'repo', slotSlug: 'web', customerSlug: 'customer', host: 'preview.test', url: 'https://preview.test/' }) as never),
  };
}
const craft = { id: 'craft-1', label: 'Craft', workspace: { workspaceId: 'workspace-1', workspaceDir: '/stale', factoryKey: 'plugin.docs/workspace' }, tabs: [], pairs: [], order: 0 };
const router = (allowedCraftIds = ['craft-1']) => createPanelTargetRouterAuthoritySnapshot({
  builtInRoutes: { settings: { location: '/settings', allowedCraftIds } },
  redirectGuards: { 'internal-route:settings': { deliveryUrl: 'https://dashboard.test/settings', upstreamOrigin: 'https://dashboard.test' } },
});

describe('production Panel target authority composition', () => {
  it('copies exact workspace, session, terminal, preview, route and guard owner definitions', async () => {
    const provider = await createProductionPanelTargetContextProvider(createProductionPanelTargetAuthorityServices({
      env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client(), getPlugins: pluginSnapshot, getRouterAuthority: router,
    }));
    expect(provider(craft, 'workspace-1')).toMatchObject({
      crafts: { 'craft-1': { allowedPluginTargets: ['plugin.docs/help'] } },
      agentSessions: { 'session-1': { location: 'https://dashboard.test/sessions/session-1' } },
      terminals: { 'terminal-1': { location: 'https://dashboard.test/terminals/terminal-1', allowedCraftIds: ['craft-1'] } },
      previews: { 'preview-1': { location: 'https://preview.test/', factoryKey: 'preview-slot', allowedCraftIds: ['craft-1'] } },
      builtInRoutes: { settings: { allowedCraftIds: ['craft-1'] } },
      redirectGuards: { 'preview:preview-1': { upstreamOrigin: 'https://preview.test' } },
    });
  });

  it('excludes identity mismatches and enforces owner allowlists without granting the requester', async () => {
    const provider = await createProductionPanelTargetContextProvider(createProductionPanelTargetAuthorityServices({
      env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client({ mismatchedPreview: true }), getPlugins: pluginSnapshot, getRouterAuthority: () => router(['craft-2']),
    }));
    expect(provider(craft, 'workspace-1')).toMatchObject({ previews: {}, builtInRoutes: {} });
  });

  it('reflects removal/tightening and distinguishes ready-empty from not-ready owners', async () => {
    const emptyServices = createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client({ includeBackend: false }), getPlugins: () => pluginSnapshot(false) });
    expect((await createProductionPanelTargetContextProvider(emptyServices))(craft, 'workspace-1')).toMatchObject({ agentSessions: {}, terminals: {}, previews: {}, builtInRoutes: {}, crafts: { 'craft-1': { allowedPluginTargets: [] } } });
    const unavailable = createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client(), getPlugins: pluginSnapshot, getRouterAuthority: () => ({ status: 'not-ready' }) });
    await expect(createProductionPanelTargetContextProvider(unavailable)).rejects.toMatchObject({ code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
    const missingWorkspaceAuthority = { ...client(), getWorkspaces: vi.fn(async () => [{ id: 'workspace-1', archived: false, agent_working_dir: '/trusted' }] as never) };
    await expect(createProductionPanelTargetContextProvider(createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: missingWorkspaceAuthority, getPlugins: pluginSnapshot, getRouterAuthority: router })))
      .rejects.toMatchObject({ code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
    const removed = createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client({ archived: true }), getPlugins: pluginSnapshot, getRouterAuthority: router });
    expect((await createProductionPanelTargetContextProvider(removed))(craft, 'workspace-1')).toBeNull();
  });
});
