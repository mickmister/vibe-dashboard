import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StandaloneDashboardPage } from './StandaloneDashboardPage';

describe('StandaloneDashboardPage', () => {
  it('provides route-owned scrolling without changing global document overflow', () => {
    const html = renderToStaticMarkup(
      React.createElement(StandaloneDashboardPage, { contentClassName: 'mx-auto max-w-test' }, 'Content'),
    );

    expect(html).toContain('data-testid="standalone-dashboard-page"');
    expect(html).toContain('h-screen');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('bg-zinc-950');
    expect(html).toContain('text-zinc-100');
    expect(html).toContain('mx-auto max-w-test');
  });
});
