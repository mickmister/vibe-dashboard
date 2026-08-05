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
});
