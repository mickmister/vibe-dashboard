import { describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION, createPluginRegistryManifest, type PluginPackageManifest } from '../src/index';

describe('plugin api package', () => {
  it('exports registry helpers and package manifest contracts for external plugins', () => {
    const registryManifest = createPluginRegistryManifest({
      id: 'app.excalidraw.canvas',
      displayName: 'Excalidraw',
      version: '1.0.0',
      frontend: { allowSameOrigin: false },
      contributions: {
        craftSurfaces: [{ key: 'canvas', title: 'Excalidraw', urlTemplate: '/canvas' }],
        internalRoutes: [{ key: 'settings', title: 'Settings', path: '/settings', urlTemplate: '/settings' }],
        tabGroupFactories: [
          {
            key: 'workspace',
            title: 'Workspace',
            description: 'Open a workspace',
            launchMode: 'vk-workspace',
            workspaceComposition: {
              tabs: [{ key: 'agent', title: 'Agent', urlTemplate: '{{origin}}/workspaces/{{workspaceId}}' }],
              primaryTabKey: 'agent',
            },
          },
        ],
      },
    });
    const packageManifest: PluginPackageManifest = {
      schemaVersion: 1,
      id: registryManifest.id,
      version: registryManifest.version,
      displayName: registryManifest.displayName,
      components: {
        frontend: { kind: 'iframe', entry: 'frontend/index.html' },
      },
    };

    expect(registryManifest.apiVersion).toBe(PLUGIN_API_VERSION);
    expect(registryManifest.frontend?.allowSameOrigin).toBe(false);
    expect(registryManifest.contributions.internalRoutes?.[0]?.path).toBe('/settings');
    expect(registryManifest.contributions.tabGroupFactories?.[0]?.workspaceComposition?.primaryTabKey).toBe('agent');
    expect(packageManifest.components.frontend?.kind).toBe('iframe');
  });
});
