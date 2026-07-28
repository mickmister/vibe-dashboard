import { describe, expect, it } from 'vitest';
import { sanitizeOtelAttributes } from './otel';

describe('otel helpers', () => {
  it('removes secrets and raw user-controlled query data from span attributes', () => {
    expect(sanitizeOtelAttributes({
      'jira.site_hostname': 'team.atlassian.net',
      accessToken: 'token-secret',
      apiToken: 'api-secret',
      authorization: 'Bearer secret',
      email: 'user@example.com',
      external_view_url: 'https://team.atlassian.net/jira/software/projects/VD/boards/1?filter=assignee%3Dabc',
      jql: 'assignee = "account-id"',
      'jira.issue_count': 12,
      'jira.has_board_id': true,
    })).toEqual({
      'jira.site_hostname': 'team.atlassian.net',
      'jira.issue_count': 12,
      'jira.has_board_id': true,
    });
  });

  it('keeps only OpenTelemetry-safe primitive attributes', () => {
    expect(sanitizeOtelAttributes({
      string: 'ok',
      number: 1,
      boolean: false,
      stringList: ['a', 'b'],
      object: { no: 'objects' },
      mixed: ['a', 1],
      infinite: Number.POSITIVE_INFINITY,
    })).toEqual({
      string: 'ok',
      number: 1,
      boolean: false,
      stringList: ['a', 'b'],
    });
  });
});
