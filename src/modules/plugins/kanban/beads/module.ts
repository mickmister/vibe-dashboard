import springboard from 'springboard';
import React from 'react';
import { ExternalBeadsBoardRoute } from './components/ExternalBeadsBoardView';

springboard.registerModule('plugin-kanban-beads', {}, async (moduleAPI) => {
  const kanbanModule = moduleAPI.getModule('plugin-kanban');
  kanbanModule.providers.register({
    id: 'beads',
    displayName: 'Beads',
    supportsExternalViewUrl: () => false,
    parseExternalViewUrl: (url) => ({
      status: 'unsupported',
      reason: 'unsupported_provider_url',
      originalUrl: url.toString(),
    }),
    renderExternalView: () => React.createElement(ExternalBeadsBoardRoute),
  });

  moduleAPI.registerRoute('/dashboard/kanban/beads', {}, () => {
    const searchParams = new URLSearchParams(window.location.search);
    return React.createElement(ExternalBeadsBoardRoute, {
      sourceDirectory: searchParams.get('sourceDirectory') ?? undefined,
    });
  });

  return {
    providerId: 'beads' as const,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-kanban-beads': {
      providerId: 'beads';
    };
  }
}
