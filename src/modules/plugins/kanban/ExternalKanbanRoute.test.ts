import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createKanbanProviderRegistry } from './module';
import {
  EXTERNAL_VIEW_URL_PARAM,
  ExternalKanbanDashboardRouteWithProviders,
  hasExternalViewQueryParam,
} from './ExternalKanbanRoute';
import type { KanbanProviderRegistration } from './contracts';

function fakeProvider(overrides: Partial<KanbanProviderRegistration> = {}): KanbanProviderRegistration {
  return {
    id: 'fake',
    displayName: 'Fake',
    supportsExternalViewUrl: (url) => url.hostname === 'fake.example.com',
    parseExternalViewUrl: (value) => ({ status: 'ok', locator: { value } }),
    renderExternalView: (locator) =>
      React.createElement('div', {}, `Fake board: ${(locator as { value: string }).value}`),
    ...overrides,
  };
}

describe('Kanban provider registry', () => {
  it('registers and lists providers in deterministic order', () => {
    const registry = createKanbanProviderRegistry();
    registry.register(fakeProvider({ id: 'zeta', displayName: 'Zeta' }));
    registry.register(fakeProvider({ id: 'alpha', displayName: 'Alpha' }));

    expect(registry.list().map((provider) => provider.id)).toEqual(['alpha', 'zeta']);
  });

  it('rejects duplicate provider ids instead of silently replacing a provider', () => {
    const registry = createKanbanProviderRegistry();
    registry.register(fakeProvider());

    expect(() => registry.register(fakeProvider({ displayName: 'Other Fake' }))).toThrow(
      "Kanban provider 'fake' is already registered.",
    );
  });
});

describe('ExternalKanbanDashboardRouteWithProviders', () => {
  it('detects canonical external_view_url query params', () => {
    expect(hasExternalViewQueryParam(`?${EXTERNAL_VIEW_URL_PARAM}=https%3A%2F%2Ffake.example.com%2Fboard`)).toBe(true);
    expect(hasExternalViewQueryParam('?other=https%3A%2F%2Ffake.example.com%2Fboard')).toBe(false);
  });

  it('renders a missing-url message when external_view_url is absent', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanDashboardRouteWithProviders, {
        search: '',
        providers: [fakeProvider()],
      }),
    );

    expect(html).toContain('Unsupported external view');
    expect(html).toContain('VD did not receive an external board URL to open.');
  });

  it('renders a malformed-url message for invalid external_view_url values', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanDashboardRouteWithProviders, {
        search: `?${EXTERNAL_VIEW_URL_PARAM}=not-a-url`,
        providers: [fakeProvider()],
      }),
    );

    expect(html).toContain('The external board URL is malformed.');
  });

  it('renders an unsupported-provider message when no provider supports the URL', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanDashboardRouteWithProviders, {
        search: `?${EXTERNAL_VIEW_URL_PARAM}=https%3A%2F%2Funsupported.example.com%2Fboard`,
        providers: [fakeProvider()],
      }),
    );

    expect(html).toContain('This read-only view currently supports registered Kanban provider URLs only.');
  });

  it('selects a matching provider, parses, and renders the provider board', () => {
    const parseExternalViewUrl = vi.fn((value: string) => ({ status: 'ok' as const, locator: { value } }));
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanDashboardRouteWithProviders, {
        search: `?${EXTERNAL_VIEW_URL_PARAM}=https%3A%2F%2Ffake.example.com%2Fboard%3Fid%3D1`,
        providers: [fakeProvider({ parseExternalViewUrl })],
      }),
    );

    expect(parseExternalViewUrl).toHaveBeenCalledWith('https://fake.example.com/board?id=1');
    expect(html).toContain('Fake board: https://fake.example.com/board?id=1');
  });

  it('smoke-tests dashboard external_view_url selection through the neutral provider route', () => {
    const registry = createKanbanProviderRegistry();
    registry.register(fakeProvider());

    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanDashboardRouteWithProviders, {
        search: `?${EXTERNAL_VIEW_URL_PARAM}=https%3A%2F%2Ffake.example.com%2Fboard`,
        providers: registry.list(),
      }),
    );

    expect(html).toContain('Fake board: https://fake.example.com/board');
  });
});
