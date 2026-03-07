import springboard from 'springboard';
import type { PluginContributions } from '../vibe-dashboard/types';

const contributions: PluginContributions = {
  tabPresets: [
    {
      key: 'vibe-kanban',
      title: 'Kanban',
      description: 'Vibe Kanban board view',
      mode: 'immediate',
      urlTemplate: '{{origin}}/',
      order: 30,
    },
  ],
  spaceTypes: [
    {
      key: 'kanban',
      icon: 'KB',
    },
  ],
};

springboard.registerModule('plugin-vibe-kanban', {}, async () => {
  return {
    contributions,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-vibe-kanban': {
      contributions: PluginContributions;
    };
  }
}
