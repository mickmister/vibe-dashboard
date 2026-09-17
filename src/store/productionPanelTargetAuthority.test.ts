/* eslint-disable formatjs/no-literal-string-in-object -- exact authority fixtures */
import { describe, expect, it, vi } from 'vitest';
import { createEmptyPluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { createProductionPanelTargetAuthorityServices, createProductionPanelTargetContextProvider } from './productionPanelTargetAuthority';

function pluginSnapshot(allowed = true) {
  const plugins = createEmptyPluginRegistryState();
  plugins.plugins['plugin.docs'] = { id: 'plugin.docs', displayName: 'Docs', version: '1', apiVersion: '1.0.0', registeredAt: 'now', contributions: {} };
  plugins.internalRoutes['plugin.docs/help'] = { pluginId: 'plugin.docs', sourceKey: 'help', key: 'plugin.docs/help', title: 'Help', path: '/help', urlTemplate: 'https://plugin.test/help', allowedParams: [] };
  plugins.tabGroupFactories['plugin.docs/workspace'] = { pluginId: 'plugin.docs', sourceKey: 'workspace', key: 'plugin.docs/workspace', title: 'Workspace', description: 'Workspace', launchMode: 'vk-workspace',
    allowedPluginTargets: allowed ? ['plugin.docs/help'] : [], workspaceComposition: { tabs: [{ key: 'help', title: 'Help', urlTemplate: 'internal://plugins/plugin.docs/help' }] } };
  return plugins;
}

function client(input: { archived?: boolean; directory?: string | null } = {}) {
  return {
    getWorkspaces: vi.fn(async () => [{ id: 'workspace-1', archived: input.archived ?? false, agent_working_dir: input.directory === undefined ? '/trusted' : input.directory }] as never),
    getWorkspaceRepos: vi.fn(async () => [{ id: 'repo-1' }] as never),
    getSessions: vi.fn(async () => [{ id: 'session-1', workspace_id: 'workspace-1' }] as never),
    getRunConfigs: vi.fn(async () => ({ run_configs: [], preview_slots: [{ id: 'preview-1' }], preview_url_parts: [] }) as never),
  };
}

const craft = { id: 'craft-1', label: 'Craft', workspace: { workspaceId: 'workspace-1', workspaceDir: '/stale', factoryKey: 'plugin.docs/workspace' }, tabs: [], pairs: [], order: 0 };

describe('production Panel target authority composition', () => {
  it('snapshots live ownership, explicit factory grants, backends and server guards', async () => {
    const provider = await createProductionPanelTargetContextProvider(createProductionPanelTargetAuthorityServices({
      env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client(), getPlugins: () => pluginSnapshot(),
    }));
    expect(provider(craft, 'workspace-1')).toMatchObject({
      crafts: { 'craft-1': { workspaceId: 'workspace-1', allowedPluginTargets: ['plugin.docs/help'] } },
      workspaces: { 'workspace-1': { available: true, repositoryIds: ['repo-1'], directory: '/trusted' } },
      agentSessions: { 'session-1': { workspaceId: 'workspace-1' } },
      previews: { 'preview-1': { workspaceId: 'workspace-1' } },
      builtInRoutes: { 'dashboard-home': { allowedCraftIds: ['craft-1'] } },
      redirectGuards: { 'preview:preview-1': expect.any(Object), 'code:workspace-1': expect.any(Object) },
    });
  });

  it('reflects policy tightening and workspace removal in subsequent snapshots', async () => {
    const services = createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client(), getPlugins: () => pluginSnapshot(false) });
    expect((await createProductionPanelTargetContextProvider(services))(craft, 'workspace-1')?.crafts['craft-1']?.allowedPluginTargets).toEqual([]);
    const removed = createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client({ archived: true }), getPlugins: pluginSnapshot });
    expect((await createProductionPanelTargetContextProvider(removed))(craft, 'workspace-1')).toBeNull();
    const pluginRemoved = createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client(), getPlugins: () => createEmptyPluginRegistryState() });
    expect((await createProductionPanelTargetContextProvider(pluginRemoved))(craft, 'workspace-1')?.crafts['craft-1']?.allowedPluginTargets).toEqual([]);
    expect((await createProductionPanelTargetContextProvider(services))({ ...craft, workspace: { ...craft.workspace, workspaceId: 'other' } }, 'workspace-1')).toBeNull();

    const moved = createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: client({ directory: '/moved' }), getPlugins: pluginSnapshot });
    expect((await createProductionPanelTargetContextProvider(moved))(craft, 'workspace-1')?.redirectGuards['code:workspace-1']?.deliveryUrl)
      .not.toBe((await createProductionPanelTargetContextProvider(services))(craft, 'workspace-1')?.redirectGuards['code:workspace-1']?.deliveryUrl);
  });

  it('fails closed until services are ready and distinguishes ready-empty categories', async () => {
    const empty = { ...client(), getRunConfigs: vi.fn(async () => ({ run_configs: [], preview_slots: [], preview_url_parts: [] }) as never) };
    const provider = await createProductionPanelTargetContextProvider(createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: empty, getPlugins: () => createEmptyPluginRegistryState() }));
    expect(provider(craft, 'workspace-1')).toMatchObject({ terminals: {}, previews: {}, builtInRoutes: { 'dashboard-home': expect.any(Object) } });
    await expect(createProductionPanelTargetContextProvider(createProductionPanelTargetAuthorityServices({ env: {}, client: client(), getPlugins: pluginSnapshot }))).rejects.toMatchObject({ code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
    const unavailable = { ...client(), getRunConfigs: vi.fn(async () => { throw new Error('not ready'); }) };
    await expect(createProductionPanelTargetContextProvider(createProductionPanelTargetAuthorityServices({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: unavailable, getPlugins: pluginSnapshot }))).rejects.toThrow('not ready');
  });
});
