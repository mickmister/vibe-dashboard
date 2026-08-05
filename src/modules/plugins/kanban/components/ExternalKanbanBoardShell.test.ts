import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExternalKanbanBoardShell, ExternalKanbanColumns } from './ExternalKanbanBoardShell';
import type { ExternalKanbanCardDto, ExternalKanbanColumnDto } from '../boardTypes';

const columns: ExternalKanbanColumnDto[] = [
  { id: 'todo', title: 'Todo', statusIds: ['todo-status'] },
  { id: 'done', title: 'Done', statusIds: ['done-status'] },
];

const cards: ExternalKanbanCardDto[] = [
  {
    id: 'issue-1',
    key: 'EXT-1',
    title: 'Shared Kanban shell',
    url: 'https://example.com/issue/EXT-1',
    statusId: 'todo-status',
    statusName: 'Todo',
    columnId: 'todo',
    labels: [],
    rank: 0,
    metadata: {},
  },
];

describe('ExternalKanbanBoardShell', () => {
  it('provides the shared vertical page scroll container used by provider boards', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ExternalKanbanBoardShell,
        null,
        React.createElement('div', null, 'Provider board'),
      ),
    );

    expect(html).toContain('h-dvh overflow-y-auto overscroll-contain');
  });

  it('provides shared horizontal column scrolling and status-column card matching', () => {
    const html = renderToStaticMarkup(
      React.createElement(ExternalKanbanColumns, {
        columns,
        cards,
        renderCard: (card) => React.createElement('article', null, card.title),
      }),
    );

    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('Shared Kanban shell');
    expect(html).toContain('Todo');
    expect(html).toContain('Done');
    expect(html).toContain('No issues');
  });
});
