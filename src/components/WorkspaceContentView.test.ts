import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { WorkspaceContentView } from './WorkspaceContentView';
import type { SessionActions, WorkspaceActions } from './WorkspaceShell';
import type { WorkspaceState } from '../types';

describe('WorkspaceContentView mobile-compatible empty state', () => {
  it('uses Voyage/Craft language and an accessible status for empty Voyages', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        IntlProvider,
        { locale: 'en' },
        React.createElement(WorkspaceContentView, {
          activeTabGroups: [],
          activeTabGroupId: '',
          actions: {} as WorkspaceActions,
          sessionActions: {} as SessionActions,
          onDragStart: () => undefined,
          onDragOver: () => undefined,
          onDrop: () => undefined,
          workspace: { spaces: [], tabGroups: [], nextId: 1 } as WorkspaceState,
          showAddressBar: false,
          savedSessions: [],
          currentSessionId: 'session',
          onResumeSession: () => undefined,
          onRenameSession: () => undefined,
          onDeleteSession: () => undefined,
          onStartNewSession: () => undefined,
          onNavigateToTabGroup: () => undefined,
          onOpenVKWorkspace: async () => undefined,
        }),
      ),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('No Craft in this Voyage');
    expect(html.toLowerCase()).not.toContain('space');
  });
});
