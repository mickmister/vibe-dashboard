import { describe, expect, it } from 'vitest';
import { parseLinearExternalViewUrl } from './externalViewUrl';

describe('parseLinearExternalViewUrl', () => {
  it('parses Linear issue URLs', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/issue/VD-123/add-linear-kanban')).toEqual({
      status: 'ok',
      locator: {
        provider: 'linear',
        viewKind: 'issue',
        originalUrl: 'https://linear.app/jamtools/issue/VD-123/add-linear-kanban',
        workspaceSlug: 'jamtools',
        issueIdentifier: 'VD-123',
        queryParams: {},
      },
    });
  });

  it('parses team URLs and preserves supported status query filter', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/team/VD/all?status=Todo')).toEqual({
      status: 'ok',
      locator: {
        provider: 'linear',
        viewKind: 'team',
        originalUrl: 'https://linear.app/jamtools/team/VD/all?status=Todo',
        workspaceSlug: 'jamtools',
        teamKey: 'VD',
        queryParams: { status: 'Todo' },
      },
    });
  });

  it('rejects unsupported query filters until exact filtering is implemented', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/team/VD/all?status=Todo&label=bug&label=api')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools/team/VD/all?status=Todo&label=bug&label=api',
    });
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/project/kanban-provider?assignee=me')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools/project/kanban-provider?assignee=me',
    });
  });

  it('parses project URLs with project-scoped filtering only', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/project/kanban-provider')).toMatchObject({
      status: 'ok',
      locator: {
        provider: 'linear',
        viewKind: 'project',
        workspaceSlug: 'jamtools',
        projectSlugOrId: 'kanban-provider',
      },
    });
  });

  it('rejects view, cycle, and bare workspace URLs until exact filtering is implemented', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/view/custom-view')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools/view/custom-view',
    });
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/project/kanban-provider/views/open')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools/project/kanban-provider/views/open',
    });
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/project/kanban-provider/cycle/current')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools/project/kanban-provider/cycle/current',
    });
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/team/VD/cycle/current')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools/team/VD/cycle/current',
    });
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools',
    });
  });

  it('returns malformed_url for bad percent-encoded paths', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/team/%E0%A4%A')).toEqual({
      status: 'unsupported',
      reason: 'malformed_url',
      originalUrl: 'https://linear.app/jamtools/team/%E0%A4%A',
    });
  });

  it('rejects non-Linear URLs', () => {
    expect(parseLinearExternalViewUrl('https://github.com/jamtools/springboard/issues')).toMatchObject({
      status: 'unsupported',
      reason: 'unsupported_provider_url',
    });
  });
});
