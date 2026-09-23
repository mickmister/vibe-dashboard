import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DockviewM34HarnessRoute } from './DockviewM34HarnessRoute';

describe('DockView M3.4 runtime budget harness', () => {
  it('TEST_CASE_M3_4F exposes tester-visible runtime budget controls and state', () => {
    const markup = renderToStaticMarkup(React.createElement(DockviewM34HarnessRoute));

    expect(markup).toContain('data-testid="dockview-m3-4-harness"');
    expect(markup).toContain('Open visible iframe');
    expect(markup).toContain('Open inactive iframe');
    expect(markup).toContain('Apply budget pressure');
    expect(markup).toContain('Switch warm Voyage');
    expect(markup).toContain('Acquire Split lease');
    expect(markup).toContain('Release Split lease');
    expect(markup).toContain('Invalidate host');
    expect(markup).toContain('DockView M3.4 runtime budget visible state');
    expect(markup).toContain('warmControllers');
    expect(markup).toContain('visibleRuntimes');
    expect(markup).toContain('reloadDisclosures');
  });
});
