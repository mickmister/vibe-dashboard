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

  it('parses top-level Linear custom view URLs for exact custom view loading', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/view/im-behind-2e841d573fab6')).toEqual({
      status: 'ok',
      locator: {
        provider: 'linear',
        viewKind: 'customView',
        originalUrl: 'https://linear.app/jamtools/view/im-behind-2e841d573fab6',
        workspaceSlug: 'jamtools',
        customViewId: 'im-behind-2e841d573fab6',
        queryParams: {},
      },
    });
  });

  it('parses Linear active team cycle URLs for exact active cycle loading', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/team/VD/cycle/active')).toEqual({
      status: 'ok',
      locator: {
        provider: 'linear',
        viewKind: 'cycle',
        originalUrl: 'https://linear.app/jamtools/team/VD/cycle/active',
        workspaceSlug: 'jamtools',
        teamKey: 'VD',
        cycleIdentifier: 'active',
        queryParams: {},
      },
    });
  });

  it('rejects Linear cycle URLs that cannot be loaded exactly yet', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/team/VD/cycle/123')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools/team/VD/cycle/123',
    });
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/team/VD/cycle/active?status=Todo')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools/team/VD/cycle/active?status=Todo',
    });
  });

  it('rejects custom view URLs with query filters until exact query filtering is implemented', () => {
    expect(parseLinearExternalViewUrl('https://linear.app/jamtools/view/reported-by-me-c10a8b8b98c26?status=Todo')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_linear_url',
      originalUrl: 'https://linear.app/jamtools/view/reported-by-me-c10a8b8b98c26?status=Todo',
    });
  });

  it('rejects nested view and bare workspace URLs until exact filtering is implemented', () => {
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
