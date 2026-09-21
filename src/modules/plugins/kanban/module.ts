import springboard from 'springboard';
import type { KanbanProviderRegistration } from './contracts';

export interface KanbanProviderRegistry {
  register: (provider: KanbanProviderRegistration) => void;
  list: () => KanbanProviderRegistration[];
}

export function createKanbanProviderRegistry(): KanbanProviderRegistry {
  const providers = new Map<string, KanbanProviderRegistration>();

  return {
    register: (provider) => {
      if (providers.has(provider.id)) {
        throw new Error(`Kanban provider '${provider.id}' is already registered.`);
      }
      providers.set(provider.id, provider);
    },
    list: () => [...providers.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

springboard.registerModule('plugin-kanban', {}, async () => {
  const providers = createKanbanProviderRegistry();
  return {
    providers,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-kanban': {
      providers: KanbanProviderRegistry;
    };
  }
}
