import { describe, expect, it } from 'vitest';
import {
  formatReviewCommentsMarkdown,
  workspaceCommentPath,
} from './diffComments';

describe('workspaceCommentPath', () => {
  it('uses repo-relative paths for single-repo workspaces', () => {
    expect(
      workspaceCommentPath(
        { repoRelativePath: 'vibe-kanban', filePath: 'src/main.ts' },
        1,
      ),
    ).toBe('src/main.ts');
  });

  it('uses workspace-relative paths for nested repos in multi-repo workspaces', () => {
    expect(
      workspaceCommentPath(
        { repoRelativePath: 'backend', filePath: 'src/main.ts' },
        2,
      ),
    ).toBe('backend/src/main.ts');
  });

  it('keeps root repo paths repo-relative even in multi-repo workspaces', () => {
    expect(
      workspaceCommentPath(
        { repoRelativePath: '.', filePath: 'src/main.ts' },
        2,
      ),
    ).toBe('src/main.ts');
  });
});

describe('formatReviewCommentsMarkdown', () => {
  it('formats comments as markdown and quotes every body line', () => {
    expect(
      formatReviewCommentsMarkdown(
        [
          {
            repoRelativePath: 'backend',
            filePath: 'src/main.ts',
            lineNumber: 12,
            body: 'First line\nSecond line',
            codeLine: 'const value = true;',
          },
        ],
        2,
      ),
    ).toContain(
      '**backend/src/main\\.ts** (Line 12)\n`const value = true;`\n\n> First line\n> Second line',
    );
  });
});
