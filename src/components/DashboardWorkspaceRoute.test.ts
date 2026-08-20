// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { DashboardWorkspaceRoute } from './DashboardWorkspaceRoute';

vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ workspaceId: 'workspace-1' }),
}));

vi.mock('../modules/plugins/vibe-dashboard/registry', () => ({
  usePluginRegistry: () => ({ tabGroupFactories: {} }),
}));

vi.mock('../hooks/useModule', () => ({
  useModule: () => ({
    states: {
      workspace: { useState: () => ({ spaces: [], tabGroups: [] }) },
      savedVoyages: { useState: () => ({ savedSessions: [] }) },
    },
    actions: {
      createSavedSessionForVKWorkspace: vi.fn(),
    },
  }),
}));

describe('DashboardWorkspaceRoute', () => {
  it('renders workspace wrapper route copy without react-intl descriptor id crashes', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        IntlProvider,
        { locale: 'en' },
        React.createElement(DashboardWorkspaceRoute),
      ),
    );

    expect(html).toContain('VD workspace link');
    expect(html).toContain('Opening workspace');
    expect(html).toContain('Opening VK workspace');
  });
});
