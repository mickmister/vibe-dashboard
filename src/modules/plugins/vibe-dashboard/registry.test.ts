import { describe, expect, it } from 'vitest';
import {
  clearPluginRegistryForTests,
  addSettingsMenu,
  createPluginManifest,
  getPluginRegistrySnapshot,
  getRegisteredPluginIframePolicy,
  registerPlugin,
  resolvePluginInternalRouteIframeSrc,
  subscribeToPluginRegistry,
} from './registry';

describe('raw plugin registry', () => {
  it('registers catalog contributions through raw in-memory functions', () => {
    clearPluginRegistryForTests();

    registerPlugin(
      createPluginManifest({
        id: 'dev.mickmister.code-server',
        displayName: 'Code Server',
        version: '1.0.0',
        contributions: {
          settingsMenus: [
            {
              key: 'vardash',
              title: 'Vardash',
              target: { kind: 'builtin', id: 'vardash' },
            },
          ],
          tabPresets: [
            {
              key: 'editor',
              title: 'Code Server',
              description: 'Editor',
              mode: 'urlPrompt',
              urlTemplate: '{{origin}}/?folder=',
            },
          ],
          craftSurfaces: [
            {
              key: 'editor',
              title: 'Code Server',
              urlTemplate: '{{origin}}/?folder={{workspacePath}}',
            },
          ],
          internalRoutes: [
            {
              key: 'settings',
              title: 'Settings',
              path: '/settings',
              urlTemplate: '{{origin}}/settings',
            },
          ],
          spaceTypes: [{ key: 'code', icon: '</>' }],
        },
      }),
    );

    expect(getPluginRegistrySnapshot()).toMatchObject({
      plugins: {
        'dev.mickmister.code-server': {
          id: 'dev.mickmister.code-server',
          apiVersion: '1.0.0',
        },
      },
      settingsMenus: {
        'dev.mickmister.code-server/vardash': {
          pluginId: 'dev.mickmister.code-server',
          sourceKey: 'vardash',
          title: 'Vardash',
          target: { kind: 'builtin', id: 'vardash' },
        },
      },
      tabPresets: {
        'dev.mickmister.code-server/editor': {
          pluginId: 'dev.mickmister.code-server',
          sourceKey: 'editor',
        },
      },
      craftSurfaces: {
        'dev.mickmister.code-server/editor': {
          pluginId: 'dev.mickmister.code-server',
          sourceKey: 'editor',
          title: 'Code Server',
        },
      },
      internalRoutes: {
        'dev.mickmister.code-server/settings': {
          pluginId: 'dev.mickmister.code-server',
          sourceKey: 'settings',
          path: '/settings',
        },
      },
      spaceTypes: {
        'dev.mickmister.code-server/code': {
          pluginId: 'dev.mickmister.code-server',
          sourceKey: 'code',
        },
      },
    });
  });

  it('notifies subscribers with immutable snapshots and removes stale contributions on re-register', () => {
    clearPluginRegistryForTests();
    const snapshots: string[] = [];
    const unsubscribe = subscribeToPluginRegistry(() => {
      snapshots.push(Object.keys(getPluginRegistrySnapshot().tabPresets).join(','));
    });

    registerPlugin(
      createPluginManifest({
        id: 'app.example',
        displayName: 'Example',
        version: '1.0.0',
        contributions: {
          settingsMenus: [
            {
              key: 'old-settings',
              title: 'Old Settings',
              target: { kind: 'builtin', id: 'vardash' },
            },
          ],
          tabPresets: [
            {
              key: 'old',
              title: 'Old',
              description: 'Old tab',
              mode: 'immediate',
              urlTemplate: '{{origin}}/old',
            },
          ],
        },
      }),
    );
    registerPlugin(
      createPluginManifest({
        id: 'app.example',
        displayName: 'Example',
        version: '1.0.1',
        contributions: {
          settingsMenus: [
            {
              key: 'new-settings',
              title: 'New Settings',
              target: { kind: 'builtin', id: 'vardash' },
            },
          ],
          tabPresets: [
            {
              key: 'new',
              title: 'New',
              description: 'New tab',
              mode: 'immediate',
              urlTemplate: '{{origin}}/new',
            },
          ],
        },
      }),
    );
    unsubscribe();

    expect(snapshots).toEqual(['app.example/old', 'app.example/new']);
    expect(Object.keys(getPluginRegistrySnapshot().tabPresets)).toEqual(['app.example/new']);
    expect(Object.keys(getPluginRegistrySnapshot().settingsMenus)).toEqual([
      'app.example/new-settings',
    ]);
  });

  it('rejects unsupported plugin API versions before mutating state', () => {
    clearPluginRegistryForTests();

    expect(() =>
      registerPlugin(
        createPluginManifest({
          id: 'app.bad',
          displayName: 'Bad',
          version: '1.0.0',
          apiVersion: '999.0.0',
          contributions: {},
        }),
      ),
    ).toThrow('targets unsupported plugin API version');
    expect(getPluginRegistrySnapshot()).toEqual({
      plugins: {},
      settingsMenus: {},
      tabPresets: {},
      spaceTypes: {},
      tabGroupFactories: {},
      craftSurfaces: {},
      internalRoutes: {},
    });
  });

  it('resolves registered plugin-owned internal routes to iframe URLs without persisting renderers', () => {
    clearPluginRegistryForTests();
    registerPlugin(
      createPluginManifest({
        id: 'app.excalidraw.canvas',
        displayName: 'Excalidraw',
        version: '1.0.0',
        contributions: {
          internalRoutes: [
            {
              key: 'canvas',
              title: 'Canvas',
              path: '/canvas',
              urlTemplate: '{{origin}}/dashboard/plugins/{{pluginId}}/1.0.0/frontend_assets/index.html#{{routePath}}',
            },
          ],
        },
      }),
    );

    expect(
      resolvePluginInternalRouteIframeSrc({
        internalUrl: 'internal://plugins/app.excalidraw.canvas/canvas',
        origin: 'https://vd.example.test',
      }),
    ).toBe('https://vd.example.test/dashboard/plugins/app.excalidraw.canvas/1.0.0/frontend_assets/index.html#/canvas');
    expect(
      resolvePluginInternalRouteIframeSrc({
        internalUrl: 'internal://plugins/app.excalidraw.canvas/missing',
        origin: 'https://vd.example.test',
      }),
    ).toBeNull();

    registerPlugin(
      createPluginManifest({
        id: 'app.excalidraw.canvas',
        displayName: 'Excalidraw',
        version: '1.0.1',
        contributions: {},
      }),
    );
    expect(
      resolvePluginInternalRouteIframeSrc({
        internalUrl: 'internal://plugins/app.excalidraw.canvas/canvas',
        origin: 'https://vd.example.test',
      }),
    ).toBeNull();
  });

  it('derives plugin iframe same-origin policy from registered plugin manifests', () => {
    clearPluginRegistryForTests();
    registerPlugin(
      createPluginManifest({
        id: 'app.storage.plugin',
        displayName: 'Storage Plugin',
        version: '1.2.3',
        frontend: { allowSameOrigin: true },
        contributions: {},
      }),
    );

    expect(
      getRegisteredPluginIframePolicy({
        iframeSrc: 'https://vd.example.test/dashboard/plugins/app.storage.plugin/1.2.3/frontend_assets/index.html',
        origin: 'https://vd.example.test',
      }),
    ).toEqual({ allowSameOrigin: true });
    expect(
      getRegisteredPluginIframePolicy({
        iframeSrc: 'https://vd.example.test/dashboard/plugins/app.storage.plugin/9.9.9/frontend_assets/index.html',
        origin: 'https://vd.example.test',
      }),
    ).toBeNull();
  });

  it('adds runtime settings menus with plugin namespacing', () => {
    clearPluginRegistryForTests();
    registerPlugin(
      createPluginManifest({
        id: 'dev.mickmister.vibe-dashboard',
        displayName: 'Vibe Dashboard',
        version: '1.0.0',
        contributions: {},
      }),
    );

    addSettingsMenu('dev.mickmister.vibe-dashboard', {
      key: 'vardash',
      title: 'Vardash',
      description: 'Manage repo environment values and launches',
      target: { kind: 'builtin', id: 'vardash' },
      order: 10,
    });

    expect(getPluginRegistrySnapshot().settingsMenus).toEqual({
      'dev.mickmister.vibe-dashboard/vardash': {
        key: 'dev.mickmister.vibe-dashboard/vardash',
        sourceKey: 'vardash',
        pluginId: 'dev.mickmister.vibe-dashboard',
        title: 'Vardash',
        description: 'Manage repo environment values and launches',
        target: { kind: 'builtin', id: 'vardash' },
        order: 10,
      },
    });
  });

  it('requires a registered plugin before adding runtime settings menus', () => {
    clearPluginRegistryForTests();

    expect(() =>
      addSettingsMenu('dev.mickmister.missing', {
        key: 'vardash',
        title: 'Vardash',
        target: { kind: 'builtin', id: 'vardash' },
      }),
    ).toThrow('Cannot add settings menu for unregistered plugin');
    expect(getPluginRegistrySnapshot().settingsMenus).toEqual({});
  });

  it('removes runtime settings menus when a plugin re-registers', () => {
    clearPluginRegistryForTests();
    registerPlugin(
      createPluginManifest({
        id: 'app.runtime',
        displayName: 'Runtime Plugin',
        version: '1.0.0',
        contributions: {},
      }),
    );
    addSettingsMenu('app.runtime', {
      key: 'vardash',
      title: 'Vardash',
      target: { kind: 'builtin', id: 'vardash' },
    });

    registerPlugin(
      createPluginManifest({
        id: 'app.runtime',
        displayName: 'Runtime Plugin',
        version: '1.0.1',
        contributions: {},
      }),
    );

    expect(getPluginRegistrySnapshot().settingsMenus).toEqual({});
  });

});
