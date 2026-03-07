import springboard from 'springboard';
import type { PluginContributions } from '../vibe-dashboard/types';

const contributions: PluginContributions = {
  tabPresets: [
    {
      key: 'code-server',
      title: 'Code Server',
      description: 'VS Code editor with custom folder path',
      mode: 'urlPrompt',
      urlTemplate: '{{origin}}/?folder=',
      defaultTitle: 'Code Server',
      order: 20,
    },
  ],
  spaceTypes: [
    {
      key: 'code',
      icon: '</>',
    },
  ],
};

springboard.registerModule('plugin-code-server', {}, async () => {
  return {
    contributions,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-code-server': {
      contributions: PluginContributions;
    };
  }
}
