import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BeadsForm pending queue UI source', () => {
  it('keeps default pending page focused on forms, not diagnostics or manual refresh chrome', async () => {
    const source = await readFile(new URL('./BeadsFormModule.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('Use Refresh after agents attach new forms');
    expect(source).not.toContain('Update strategy');
    expect(source).not.toContain('Skipped repos');
    expect(source).not.toContain('Refreshing in the background… cached results remain visible.');
    expect(source).not.toContain('>Refresh<');
    expect(source).toContain('Checking for updates…');
    expect(source).toContain('Loading pending BeadsForms');
  });

  it('uses a submitted success state with normalized JSON copy fallback instead of showing the active form', async () => {
    const source = await readFile(new URL('./BeadsFormModule.tsx', import.meta.url), 'utf8');

    expect(source).toContain('copyNormalizedSubmittedResultJson(navigator.clipboard, result.values)');
    expect(source).toContain('pendingNormalizedSubmittedResultCopy(result.values)');
    expect(source).toContain('Copying normalized submitted response JSON…');
    expect(source).toContain('Normalized submitted response JSON');
    expect(source).toContain('Clipboard copy is unavailable. Use the manual copy field below.');
    expect(source).toContain('loaded?.selectedForm && !submitResult');
    expect(source).toContain("form && status.status !== 'success'");
    expect(source).toContain('selectedForm && submitResult');
    expect(source).not.toContain('Copied the agent-facing response text to your clipboard');
  });

  it('sets aggregate success before awaiting clipboard completion', async () => {
    const source = await readFile(new URL('./BeadsFormModule.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('await copyNormalizedSubmittedResultJson');
    expect(source).toContain('clipboardStatus: pendingCopy.status');
    expect(source).toContain('void copyNormalizedSubmittedResultJson(navigator.clipboard, result.values).then((copyResult) => {');
  });
});
