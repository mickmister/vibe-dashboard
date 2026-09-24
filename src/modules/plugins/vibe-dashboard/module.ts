import springboard from 'springboard';
import {
  getPluginRegistrySnapshot,
  registerPlugin,
  subscribeToPluginRegistry,
  usePluginRegistry,
} from './registry';
import type { PluginManifest, PluginRegistryState } from './types';

springboard.registerModule('plugin-registry', {}, async () => {
  return {
    registry: {
      getSnapshot: getPluginRegistrySnapshot,
      subscribe: subscribeToPluginRegistry,
      useState: usePluginRegistry,
    },
    registerPlugin,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-registry': {
      registry: {
        getSnapshot: () => PluginRegistryState;
        subscribe: (listener: () => void) => () => void;
        useState: () => PluginRegistryState;
      };
      registerPlugin: (manifest: PluginManifest) => void;
    };
  }
}
