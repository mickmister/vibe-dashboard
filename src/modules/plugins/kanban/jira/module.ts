import springboard from 'springboard';
import React from 'react';
import { ExternalJiraBoardRoute } from './components/ExternalJiraBoardView';
import {
  parseExternalViewUrl,
  type ExternalViewLocator,
} from './externalViewUrl';
import { EXTERNAL_VIEW_URL_PARAM } from '../ExternalKanbanRoute';

springboard.registerModule('plugin-kanban-jira', {}, async (moduleAPI) => {
  const kanbanModule = moduleAPI.getModule('plugin-kanban');
  kanbanModule.providers.register({
    id: 'jira',
    displayName: 'Jira',
    supportsExternalViewUrl: (url) => url.hostname.toLowerCase().endsWith('.atlassian.net'),
    parseExternalViewUrl,
    renderExternalView: (locator) =>
      React.createElement(ExternalJiraBoardRoute, {
        parseResult: {
          status: 'ok',
          sourceParam: EXTERNAL_VIEW_URL_PARAM,
          locator: locator as ExternalViewLocator,
        },
      }),
  });

  return {
    providerId: 'jira' as const,
  };
});

declare module 'springboard/module_registry/module_registry' {
  interface AllModules {
    'plugin-kanban-jira': {
      providerId: 'jira';
    };
  }
}
