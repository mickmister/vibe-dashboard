import springboard from 'springboard';
import React from 'react';
import { registerKanbanProvider } from '../contracts';
import { ExternalJiraBoardRoute } from './components/ExternalJiraBoardView';
import { DashboardWorkspaceRoute } from './components/VdWorkspaceLinkRoute';
import {
  EXTERNAL_VIEW_URL_PARAM,
  parseExternalViewUrl,
  type ExternalViewLocator,
} from './externalViewUrl';

registerKanbanProvider({
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

springboard.registerModule('plugin-kanban-jira', {}, async (moduleAPI) => {
  moduleAPI.registerRoute(
    '/dashboard/workspaces/:workspaceId',
    { hideApplicationShell: true },
    DashboardWorkspaceRoute,
  );

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
