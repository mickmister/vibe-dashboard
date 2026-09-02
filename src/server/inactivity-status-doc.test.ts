import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('runtime inactivity status contract docs', () => {
  it('documents local-only scope, fail-safe idle behavior, and forbidden raw evidence', async () => {
    const doc = await readFile('docs/runtime-inactivity-status-contract.md', 'utf8');

    expect(doc).toContain('/internal/inactivity/status');
    expect(doc).toContain('local-only');
    expect(doc).toContain('15-minute pilot target');
    expect(doc).toContain('Unknown state fails safe');
    expect(doc).toContain('Automatic suspend remains');
    expect(doc).toContain('does not emit workspace names, repo names/URLs, prompts, commands');
  });
});
