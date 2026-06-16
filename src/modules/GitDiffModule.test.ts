import { describe, expect, it } from 'vitest';
import {
  isSafeGitRef,
  parseHeadRefs,
  selectWorkspaceRepoPaths,
} from './GitDiffModule';

describe('parseHeadRefs', () => {
  it('parses repository head refs from action input', () => {
    expect(
      parseHeadRefs({
        '.': 'HEAD',
        repo: 'abc123 ',
        ignored: 42 as unknown as string,
      }),
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

describe('selectWorkspaceRepoPaths', () => {
  it('uses VK workspace repo metadata as the source of truth for multi-repo workspaces', () => {
    expect(
      selectWorkspaceRepoPaths(
        [
          '/workspace/backend',
          '/workspace/frontend',
          '/workspace/untracked',
        ],
        '/workspace',
        [
          {
            name: 'frontend',
            display_name: 'Web UI',
            target_branch: 'main',
          },
          {
            name: 'backend',
            display_name: 'API',
            target_branch: 'main',
          },
        ],
      ),
    ).toEqual(['/workspace/frontend', '/workspace/backend']);
  });

  it('allows a single root repo even when its checkout folder does not match VK metadata', () => {
    expect(
      selectWorkspaceRepoPaths(['/workspace'], '/workspace', [
        {
          name: 'vibe-kanban',
          display_name: 'vibe-kanban',
          target_branch: 'main',
        },
      ]),
    ).toEqual(['/workspace']);
  });

  it('falls back to discovered repos when VK metadata is unavailable', () => {
    expect(
      selectWorkspaceRepoPaths(
        ['/workspace/b', '/workspace/a'],
        '/workspace',
        [],
      ),
    ).toEqual(['/workspace/a', '/workspace/b']);
  });
});
