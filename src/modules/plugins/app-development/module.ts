import springboard from 'springboard';
import type { PluginContributions } from '../vibe-dashboard/types';

const contributions: PluginContributions = {
  tabGroupFactories: [
    {
      key: 'app-development',
      title: 'Open Existing Workspace',
      description: 'Add workspace with Agent + Code split view',
      launchMode: 'vk-workspace',
      order: 10,
    },
  ],
};

springboard.registerModule('plugin-app-development', {}, async () => {
  return {
    contributions,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-app-development': {
      contributions: PluginContributions;
    };
  }
}
