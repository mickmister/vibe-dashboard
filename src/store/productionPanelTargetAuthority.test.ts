/* eslint-disable formatjs/no-literal-string-in-object -- exact authority fixtures */
import { describe, expect, it, vi } from 'vitest';
import { createEmptyPluginRegistryState } from '../modules/plugins/vibe-dashboard/types';
import { createProductionPanelTargetContextProvider } from './productionPanelTargetAuthority';

const configuration = JSON.stringify({
  hostOrigin: 'https://dashboard.test', workspaceOrigin: 'https://vk.test',
  locations: { overview: '/workspaces/{{workspaceId}}', code: '/workspaces/{{workspaceId}}/code', changes: '/changes', beads: '/beads', forms: '/forms' },
  redirectGuards: { 'code:workspace-1': { deliveryUrl: 'https://dashboard.test/guard/code', upstreamOrigin: 'https://vk.test' } },
  craftPluginAuthorizations: { 'craft-1': ['plugin.docs/help'] },
});

describe('production Panel target authority snapshot', () => {
  it('uses live workspace ownership and exact per-Craft plugin authorization', async () => {
    const plugins = createEmptyPluginRegistryState();
    plugins.plugins['plugin.docs'] = { id: 'plugin.docs', displayName: 'Docs', version: '1', apiVersion: '1.0.0', registeredAt: 'now',
      contributions: { internalRoutes: [{ key: 'help', title: 'Help', path: '/help', urlTemplate: 'https://plugin.test/help', allowedParams: [] }] } };
    plugins.internalRoutes['plugin.docs/help'] = { pluginId: 'plugin.docs', sourceKey: 'help', key: 'plugin.docs/help', title: 'Help', path: '/help', urlTemplate: 'https://plugin.test/help', allowedParams: [] };
    const client = {
      getWorkspaces: vi.fn(async () => [{ id: 'workspace-1', archived: false, agent_working_dir: '/trusted' }] as never),
      getWorkspaceRepos: vi.fn(async () => [{ id: 'repo-1' }] as never), getSessions: vi.fn(async () => []),
    };
    const provider = await createProductionPanelTargetContextProvider({ env: { VD_VOYAGE_TARGET_AUTHORITY_JSON: configuration }, client, pluginRegistry: plugins });
    const craft = { id: 'craft-1', label: 'Craft', workspace: { workspaceId: 'workspace-1', workspaceDir: '/stale' }, tabs: [], pairs: [], order: 0 };
    expect(provider(craft, 'workspace-1')).toMatchObject({
      crafts: { 'craft-1': { workspaceId: 'workspace-1', allowedPluginTargets: ['plugin.docs/help'] } },
      workspaces: { 'workspace-1': { available: true, repositoryIds: ['repo-1'], directory: '/trusted' } },
    });
    expect(provider({ ...craft, id: 'unauthorized' }, 'workspace-1')?.crafts.unauthorized?.allowedPluginTargets).toEqual([]);
    expect(provider(craft, 'deleted')).toBeNull();
  });

  it('fails closed when required production authority configuration or services are missing', async () => {
    await expect(createProductionPanelTargetContextProvider({ env: {}, client: {} as never }))
      .rejects.toMatchObject({ code: 'MIGRATION_AUTHORITY_UNAVAILABLE' });
    const noPlugins = JSON.stringify({ ...JSON.parse(configuration), craftPluginAuthorizations: {} });
    await expect(createProductionPanelTargetContextProvider({ env: { VD_VOYAGE_TARGET_AUTHORITY_JSON: noPlugins }, client: {
      getWorkspaces: vi.fn(async () => { throw new Error('VK unavailable'); }),
    } as never })).rejects.toThrow('VK unavailable');
  });
});
