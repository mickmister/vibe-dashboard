/* eslint-disable formatjs/no-literal-string-in-object -- exact authority fixtures */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { createProductionPanelTargetContextProvider } from './productionPanelTargetAuthority';
import { clearPanelTargetRuntimeRegistryForTests, replacePanelTargetRuntimeRegistry } from './panelTargetRuntimeRegistry';

describe('production Panel target authority snapshot', () => {
  afterEach(clearPanelTargetRuntimeRegistryForTests);
  it('uses live workspace ownership and exact per-Craft plugin authorization', async () => {
    const plugins = createEmptyPluginRegistryState();
    plugins.plugins['plugin.docs'] = { id: 'plugin.docs', displayName: 'Docs', version: '1', apiVersion: '1.0.0', registeredAt: 'now',
      contributions: { internalRoutes: [{ key: 'help', title: 'Help', path: '/help', urlTemplate: 'https://plugin.test/help', allowedParams: [] }],
        tabGroupFactories: [{ key: 'workspace', title: 'Workspace', description: 'Workspace', launchMode: 'vk-workspace', workspaceComposition: { tabs: [{ key: 'help', title: 'Help', urlTemplate: 'internal://plugins/plugin.docs/help' }] } }] } };
    plugins.internalRoutes['plugin.docs/help'] = { pluginId: 'plugin.docs', sourceKey: 'help', key: 'plugin.docs/help', title: 'Help', path: '/help', urlTemplate: 'https://plugin.test/help', allowedParams: [] };
    plugins.tabGroupFactories['plugin.docs/workspace'] = { pluginId: 'plugin.docs', sourceKey: 'workspace', key: 'plugin.docs/workspace', title: 'Workspace', description: 'Workspace', launchMode: 'vk-workspace', workspaceComposition: { tabs: [{ key: 'help', title: 'Help', urlTemplate: 'internal://plugins/plugin.docs/help' }] } };
    const client = {
      getWorkspaces: vi.fn(async () => [{ id: 'workspace-1', archived: false, agent_working_dir: '/trusted' }] as never),
      getWorkspaceRepos: vi.fn(async () => [{ id: 'repo-1' }] as never), getSessions: vi.fn(async () => []),
    };
    replacePanelTargetRuntimeRegistry({ terminals: { terminal: { workspaceId: 'workspace-1', location: '/terminal' } }, previews: {}, builtInRoutes: {} });
    const provider = await createProductionPanelTargetContextProvider({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client, pluginRegistry: plugins });
    const craft = { id: 'craft-1', label: 'Craft', workspace: { workspaceId: 'workspace-1', workspaceDir: '/stale' },
      tabs: [{ id: 'help', title: 'Help', url: 'internal://plugins/plugin.docs/help' }], pairs: [], order: 0 };
    expect(provider(craft, 'workspace-1')).toMatchObject({
      crafts: { 'craft-1': { workspaceId: 'workspace-1', allowedPluginTargets: ['plugin.docs/help'] } },
      workspaces: { 'workspace-1': { available: true, repositoryIds: ['repo-1'], directory: '/trusted' } },
    });
    expect(provider({ ...craft, id: 'unauthorized', tabs: [] }, 'workspace-1')?.crafts.unauthorized?.allowedPluginTargets).toEqual([]);
    expect(provider(craft, 'workspace-1')?.terminals).toHaveProperty('terminal');
    expect(provider(craft, 'deleted')).toBeNull();
  });

  it('fails closed when required production authority configuration or services are missing', async () => {
    await expect(createProductionPanelTargetContextProvider({ env: {}, client: {} as never }))
      .rejects.toMatchObject({ code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
    await expect(createProductionPanelTargetContextProvider({ env: { VITE_VK_BASE_ORIGIN: 'https://dashboard.test' }, client: {
      getWorkspaces: vi.fn(async () => { throw new Error('VK unavailable'); }),
    } as never })).rejects.toThrow('VK unavailable');
  });
});
