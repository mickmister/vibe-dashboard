import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SpacesOverview.tsx', import.meta.url), 'utf8');

describe('SpacesOverview Vardash entry points', () => {
  it('does not expose direct Vardash route links from the overview', () => {
    expect(source).not.toContain('/dashboard/vardash');
    expect(source).not.toContain('buildVardashWorkspaceRepoHref');
    expect(source).not.toContain('Open Vardash for');
  });
});
