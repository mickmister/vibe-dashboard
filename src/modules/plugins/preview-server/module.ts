import springboard from 'springboard';
import type { PluginManifest } from '../vibe-dashboard/types';
import { createPluginManifest, registerPlugin } from '../vibe-dashboard/registry';

const manifest: PluginManifest = createPluginManifest({
  id: 'dev.mickmister.preview-server',
  displayName: 'PreviewServer',
  version: '1.0.0',
  contributions: {
    craftSurfaces: [
      {
        key: 'run-configs',
        title: 'PreviewServer',
        urlTemplate: 'internal://preview-run-configs',
        defaultTitle: 'PreviewServer',
        order: 30,
      },
    ],
  },
});

registerPlugin(manifest);

springboard.registerModule('plugin-preview-server', {}, async () => {
  return {
    manifest,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-preview-server': {
      manifest: PluginManifest;
    };
  }
}
