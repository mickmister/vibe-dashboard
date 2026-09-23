// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VibeIntlProvider } from '../i18n';
import { DashboardWorkspaceRoute } from './DashboardWorkspaceRoute';
import type { WorkspaceState } from '../types';

const mocks = vi.hoisted(() => ({
  useModule: vi.fn(),
  usePluginRegistry: vi.fn(),
}));

vi.mock('../hooks/useModule', () => ({ useModule: mocks.useModule }));
vi.mock('../modules/plugins/vibe-dashboard/registry', () => ({
  usePluginRegistry: mocks.usePluginRegistry,
}));

const workspace = {
  spaces: [{ id: 'space-a', name: 'Space', icon: '🚀', tabGroupIds: [] }],
  nextId: 0,
  tabGroups: [],
} satisfies WorkspaceState;

function routeTree(path = '/dashboard/workspaces/workspace-a?plugin=demo&ref=abc') {
  return React.createElement(
    VibeIntlProvider,
    null,
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/dashboard/workspaces/:workspaceId',
          element: React.createElement(DashboardWorkspaceRoute),
        }),
        React.createElement(Route, {
          path: '/',
          element: React.createElement('div', null, 'Dashboard home'),
        }),
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DashboardWorkspaceRoute', () => {
  it('renders safe workspace-opener recovery for generated/plugin query links without intl id crashes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.useModule.mockReturnValue({
      states: {
        workspace: { useState: () => workspace },
        savedVoyages: { useState: () => [] },
      },
      actions: {},
    });
    mocks.usePluginRegistry.mockReturnValue({
      plugins: {},
      tabPresets: {},
      spaceTypes: {},
      tabGroupFactories: {},
      craftSurfaces: {},
      internalRoutes: {},
    });

    const view = render(routeTree());
    await screen.findByText('Workspace link unavailable');
    expect(screen.getByText('VD could not find a workspace view factory for this link.')).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('id must be provided'));

    view.unmount();
    render(routeTree());
    await waitFor(() => {
      expect(screen.getByText('Workspace link unavailable')).toBeTruthy();
    });
  });
});
