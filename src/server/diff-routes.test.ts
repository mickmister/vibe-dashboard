import { describe, expect, it } from 'vitest';
import { isSafeGitRef, parseHeadRefQuery } from './diff-routes';

describe('parseHeadRefQuery', () => {
  it('parses repository head refs from JSON query data', () => {
    expect(
      parseHeadRefQuery(
        JSON.stringify({
          '.': 'HEAD',
          repo: 'abc123 ',
          ignored: 42,
        }),
      ),
    ).toEqual(
      new Map([
        ['.', 'HEAD'],
        ['repo', 'abc123'],
      ]),
    );
  });
});

describe('isSafeGitRef', () => {
  it('allows ordinary branch names and commit shas', () => {
    expect(isSafeGitRef('HEAD')).toBe(true);
    expect(isSafeGitRef('feature/diff-view')).toBe(true);
    expect(isSafeGitRef('abc123')).toBe(true);
  });

  it('rejects refs that can be interpreted as options or revset syntax', () => {
    expect(isSafeGitRef('--help')).toBe(false);
    expect(isSafeGitRef('main..feature')).toBe(false);
    expect(isSafeGitRef('HEAD@{1}')).toBe(false);
    expect(isSafeGitRef('feature:src/file.ts')).toBe(false);
  });
});
