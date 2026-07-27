import { describe, expect, it } from 'vitest';
import {
  buildExternalViewDashboardUrl,
  parseDashboardExternalViewLocator,
  parseExternalViewUrl,
} from './externalViewUrl';

describe('externalViewUrl', () => {
  it('parses canonical Jira software board URLs with project and board ids', () => {
    expect(
      parseExternalViewUrl(
        'https://example.atlassian.net/jira/software/projects/ABC/boards/1?selectedIssue=ABC-12#details',
      ),
    ).toEqual({
      status: 'ok',
      locator: {
        provider: 'jira',
        viewKind: 'board',
        originalUrl:
          'https://example.atlassian.net/jira/software/projects/ABC/boards/1?selectedIssue=ABC-12#details',
        siteHostname: 'example.atlassian.net',
        projectKey: 'ABC',
        boardId: '1',
      },
    });
  });

  it('parses Jira board URLs that include the cloud route marker', () => {
    expect(
      parseExternalViewUrl('https://example.atlassian.net/jira/software/c/projects/VD/boards/42/backlog'),
    ).toEqual({
      status: 'ok',
      locator: {
        provider: 'jira',
        viewKind: 'board',
        originalUrl: 'https://example.atlassian.net/jira/software/c/projects/VD/boards/42/backlog',
        siteHostname: 'example.atlassian.net',
        projectKey: 'VD',
        boardId: '42',
      },
    });
  });

  it('parses Jira project list URLs without requiring a board id', () => {
    expect(parseExternalViewUrl('https://example.atlassian.net/jira/software/projects/VD/list')).toEqual({
      status: 'ok',
      locator: {
        provider: 'jira',
        viewKind: 'list',
        originalUrl: 'https://example.atlassian.net/jira/software/projects/VD/list',
        siteHostname: 'example.atlassian.net',
        projectKey: 'VD',
      },
    });
  });

  it('parses Jira Core project board URLs without requiring an Agile board id', () => {
    const url = 'https://jamtools.atlassian.net/jira/core/projects/SM/board?filter=assignee%20%3D%20%22557058%3A12f5f56d-3d07-4f12-8751-bf00efed200b%22&groupBy=none';

    expect(parseExternalViewUrl(url)).toEqual({
      status: 'ok',
      locator: {
        provider: 'jira',
        viewKind: 'list',
        originalUrl: url,
        siteHostname: 'jamtools.atlassian.net',
        projectKey: 'SM',
      },
    });
  });

  it('parses Jira project pages as project locators when a board/list view is not present', () => {
    expect(parseExternalViewUrl('https://example.atlassian.net/jira/software/projects/VD')).toEqual({
      status: 'ok',
      locator: {
        provider: 'jira',
        viewKind: 'project',
        originalUrl: 'https://example.atlassian.net/jira/software/projects/VD',
        siteHostname: 'example.atlassian.net',
        projectKey: 'VD',
      },
    });
  });

  it('returns malformed_url instead of throwing for malformed percent-encoded Jira path segments', () => {
    expect(parseExternalViewUrl('https://x.atlassian.net/jira/software/projects/%E0%A4%A/boards/1')).toEqual({
      status: 'unsupported',
      reason: 'malformed_url',
      originalUrl: 'https://x.atlassian.net/jira/software/projects/%E0%A4%A/boards/1',
    });
  });

  it('returns malformed_url instead of throwing for malformed percent-encoded legacy GitHub paths', () => {
    expect(
      parseDashboardExternalViewLocator(
        '?open_from_github=https%3A%2F%2Fgithub.com%2Foctocat%2F%25E0%25A4%25A%2Fissues%2F1',
      ),
    ).toEqual({
      status: 'unsupported',
      reason: 'malformed_url',
      sourceParam: 'open_from_github',
      originalUrl: 'https://github.com/octocat/%E0%A4%A/issues/1',
    });
  });

  it('rejects malformed URLs with a user-actionable reason', () => {
    expect(parseExternalViewUrl('not a url')).toEqual({
      status: 'unsupported',
      reason: 'malformed_url',
      originalUrl: 'not a url',
    });
  });

  it('rejects unsupported non-Jira URLs without throwing', () => {
    expect(parseExternalViewUrl('https://linear.app/acme/team/VD/all')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_provider_url',
      originalUrl: 'https://linear.app/acme/team/VD/all',
    });
  });

  it('rejects Jira pages that do not identify a board, list, or project view', () => {
    expect(parseExternalViewUrl('https://example.atlassian.net/jira/people/team')).toEqual({
      status: 'unsupported',
      reason: 'unsupported_jira_url',
      originalUrl: 'https://example.atlassian.net/jira/people/team',
    });
  });

  it('uses external_view_url as the canonical dashboard query param', () => {
    expect(
      parseDashboardExternalViewLocator(
        '?external_view_url=https%3A%2F%2Fexample.atlassian.net%2Fjira%2Fsoftware%2Fprojects%2FVD%2Fboards%2F9',
      ),
    ).toEqual({
      status: 'ok',
      sourceParam: 'external_view_url',
      locator: {
        provider: 'jira',
        viewKind: 'board',
        originalUrl: 'https://example.atlassian.net/jira/software/projects/VD/boards/9',
        siteHostname: 'example.atlassian.net',
        projectKey: 'VD',
        boardId: '9',
      },
    });
  });

  it('preserves legacy open_from_github query params as GitHub locators', () => {
    expect(
      parseDashboardExternalViewLocator(
        '?open_from_github=https%3A%2F%2Fgithub.com%2Foctocat%2FHello-World%2Fissues%2F1',
      ),
    ).toEqual({
      status: 'ok',
      sourceParam: 'open_from_github',
      locator: {
        provider: 'github',
        originalUrl: 'https://github.com/octocat/Hello-World/issues/1',
        owner: 'octocat',
        repo: 'Hello-World',
        issueNumber: '1',
      },
    });
  });

  it('preserves legacy from_gh_url query params as GitHub locators', () => {
    expect(
      parseDashboardExternalViewLocator(
        '?from_gh_url=https%3A%2F%2Fgithub.com%2Foctocat%2FHello-World%2Fpull%2F2',
      ),
    ).toEqual({
      status: 'ok',
      sourceParam: 'from_gh_url',
      locator: {
        provider: 'github',
        originalUrl: 'https://github.com/octocat/Hello-World/pull/2',
        owner: 'octocat',
        repo: 'Hello-World',
        pullNumber: '2',
      },
    });
  });

  it('prefers canonical external_view_url over legacy params when both are present', () => {
    const search = new URLSearchParams();
    search.set('open_from_github', 'https://github.com/octocat/Hello-World/issues/1');
    search.set('external_view_url', 'https://example.atlassian.net/jira/software/projects/VD/list');

    const result = parseDashboardExternalViewLocator(`?${search.toString()}`);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.sourceParam).toBe('external_view_url');
      expect(result.locator.provider).toBe('jira');
    }
  });

  it('returns missing_external_view_url when no supported param is present', () => {
    expect(parseDashboardExternalViewLocator('?voyage=home')).toEqual({
      status: 'unsupported',
      reason: 'missing_external_view_url',
    });
  });

  it('builds extension launch URLs with canonical external_view_url encoding', () => {
    expect(
      buildExternalViewDashboardUrl({
        dashboardOrigin: 'https://dash.example.com/',
        externalViewUrl: 'https://example.atlassian.net/jira/software/projects/VD/boards/1?selectedIssue=VD-7',
      }),
    ).toBe(
      'https://dash.example.com/dashboard?external_view_url=https%3A%2F%2Fexample.atlassian.net%2Fjira%2Fsoftware%2Fprojects%2FVD%2Fboards%2F1%3FselectedIssue%3DVD-7',
    );
  });
});
