import springboard from 'springboard';
import { getKanbanProviders, registerKanbanProvider, type KanbanProviderRegistration } from './contracts';

springboard.registerModule('plugin-kanban', {}, async () => {
  return {
    providers: {
      register: registerKanbanProvider,
      list: getKanbanProviders,
    },
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-kanban': {
      providers: {
        register: (provider: KanbanProviderRegistration) => void;
        list: () => KanbanProviderRegistration[];
      };
    };
  }
}
