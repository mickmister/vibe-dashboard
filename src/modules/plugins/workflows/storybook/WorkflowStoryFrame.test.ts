import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowStoryFrame } from './WorkflowStoryFrame';

describe('WorkflowStoryFrame', () => {
  it('provides an internal scroll root for long Storybook workflow panes', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        WorkflowStoryFrame,
        { title: 'Scrollable workflow story', children: React.createElement('div', { style: { height: '120rem' } }, 'Long workflow story') },
      ),
    );

    expect(html).toContain('data-workflow-story-scroll-root="true"');
    expect(html).toContain('h-screen');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('Long workflow story');
  });
});
