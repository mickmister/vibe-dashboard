import { describe, expect, it } from 'vitest';
import {
  buildPluginFrontendAssetRoute,
  buildPluginInternalUrl,
  getPluginIframePolicy,
  isPluginFrontendAssetUrl,
  parsePluginFrontendAssetRoute,
  parsePluginInternalUrl,
  validateExternalPluginRuntimeManifest,
  type ExternalPluginRuntimeManifest,
} from './runtime';

describe('plugin runtime production helpers', () => {
  it('builds and parses immutable frontend asset routes', () => {
    const route = buildPluginFrontendAssetRoute({
      pluginId: 'dev.vibe-kanban.fixture-plugin',
      version: '1.0.0',
      assetPath: 'index.html',
    });

    expect(route).toBe('/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/index.html');
    expect(parsePluginFrontendAssetRoute(route)).toEqual({
      pluginId: 'dev.vibe-kanban.fixture-plugin',
      version: '1.0.0',
      assetPath: 'index.html',
    });
    expect(parsePluginFrontendAssetRoute('/dashboard/plugins/plugin/1.0.0/frontend_assets/../secret')).toBeNull();
  });

  it('keeps same-origin plugin asset iframes sandboxed as untrusted by default', () => {
    const sameOriginUrl = 'https://vd.example.test/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/index.html';

    expect(isPluginFrontendAssetUrl(sameOriginUrl, 'https://vd.example.test')).toBe(true);
    expect(getPluginIframePolicy({ iframeSrc: sameOriginUrl, hostOrigin: 'https://vd.example.test' })).toEqual({
      sandbox: 'allow-scripts',
      allow: 'fullscreen',
      targetOrigin: 'null',
      isPluginFrontendAsset: true,
      requiresSeparateOriginForSameOriginStorage: false,
    });
  });

  it('allows admin-approved same-origin storage only on a separate plugin origin', () => {
    const pluginOriginUrl = 'https://plugins.example.test/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/index.html';

    expect(
      getPluginIframePolicy({
        iframeSrc: pluginOriginUrl,
        hostOrigin: 'https://vd.example.test',
        allowSameOrigin: true,
      }),
    ).toEqual({
      sandbox: 'allow-scripts allow-same-origin',
      allow: 'fullscreen',
      targetOrigin: 'https://plugins.example.test',
      isPluginFrontendAsset: true,
      requiresSeparateOriginForSameOriginStorage: false,
    });

    expect(
      getPluginIframePolicy({
        iframeSrc: 'https://vd.example.test/dashboard/plugins/dev.vibe-kanban.fixture-plugin/1.0.0/frontend_assets/index.html',
        hostOrigin: 'https://vd.example.test',
        allowSameOrigin: true,
      }),
    ).toMatchObject({
      sandbox: 'allow-scripts',
      requiresSeparateOriginForSameOriginStorage: true,
    });
  });

  it('validates external runtime manifests without trusted host-script V1', () => {
    const valid: ExternalPluginRuntimeManifest = {
      schemaVersion: 1,
      id: 'dev.vibe-kanban.fixture-plugin',
      version: '1.0.0',
      displayName: 'Fixture Plugin',
      frontend: {
        entry: 'frontend/index.html',
        sandbox: {
          allowScripts: true,
          allowSameOrigin: false,
          rpcGrants: ['contribution.register'],
        },
      },
    };

    expect(validateExternalPluginRuntimeManifest(valid)).toEqual([]);
    expect(validateExternalPluginRuntimeManifest({ ...valid, frontend: undefined })).toContain(
      'Plugin must declare frontend, backend, or both',
    );
    expect(
      validateExternalPluginRuntimeManifest({
        ...valid,
        frontend: {
          ...valid.frontend!,
          hostScript: { entry: 'host.js' },
        },
      }),
    ).toContain('Trusted host-script frontend plugins are not supported in V1');
  });

  it('builds and parses plugin-owned internal URLs safely', () => {
    const internalUrl = buildPluginInternalUrl({
      pluginId: 'app.excalidraw.canvas',
      routePath: '/canvas/board-1',
    });

    expect(internalUrl).toBe('internal://plugins/app.excalidraw.canvas/canvas/board-1');
    expect(parsePluginInternalUrl(internalUrl)).toEqual({
      pluginId: 'app.excalidraw.canvas',
      routePath: '/canvas/board-1',
    });
    expect(parsePluginInternalUrl('internal://spaces-overview')).toBeNull();
    expect(parsePluginInternalUrl('internal://plugins/app.excalidraw.canvas/../secrets')).toBeNull();
    expect(() =>
      buildPluginInternalUrl({ pluginId: 'app.excalidraw.canvas', routePath: '../secrets' }),
    ).toThrow('Unsafe plugin internal route path');
  });

});
