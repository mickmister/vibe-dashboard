import springboard from 'springboard';
import React from 'react';
import { ExternalLinearBoardRoute } from './components/ExternalLinearBoardView';
import { isLinearUrl, parseLinearExternalViewUrl } from './externalViewUrl';
import type { LinearExternalViewLocator } from './externalViewUrl';

springboard.registerModule('plugin-kanban-linear', {}, async (moduleAPI) => {
  const kanbanModule = moduleAPI.getModule('plugin-kanban');
  kanbanModule.providers.register({
    id: 'linear',
    displayName: 'Linear',
    supportsExternalViewUrl: isLinearUrl,
    parseExternalViewUrl: parseLinearExternalViewUrl,
    renderExternalView: (locator) =>
      React.createElement(ExternalLinearBoardRoute, {
        locator: locator as LinearExternalViewLocator,
      }),
  });

  return {
    providerId: 'linear' as const,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-kanban-linear': {
      providerId: 'linear';
    };
  }
}
