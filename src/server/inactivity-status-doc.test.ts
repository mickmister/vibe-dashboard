import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('runtime inactivity status contract docs', () => {
  it('documents local-only scope, fail-safe idle behavior, and forbidden raw evidence', async () => {
    const doc = await readFile('docs/runtime-inactivity-status-contract.md', 'utf8');

    expect(doc).toContain('/internal/inactivity/status');
    expect(doc).toContain('local-only');
    expect(doc).toContain('15-minute pilot target');
    expect(doc).toContain('Unknown explicit presence fails safe');
    expect(doc).toContain('POST /internal/inactivity/browser-activity');
    expect(doc).toContain('browser_editor_activity');
    expect(doc).toContain('Automatic suspend remains');
    expect(doc).toContain('does not emit workspace names, repo names/URLs, prompts, commands');
  });
});
