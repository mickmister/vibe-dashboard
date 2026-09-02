import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BeadsForm page header source', () => {
  it('keeps selected form title and description in the compiled form header only', async () => {
    const source = await readFile(new URL('./BeadsFormModule.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('stripCompiledFormHeader');
    expect(source).toContain('className="beadsform-page-chrome beadsform-page-chrome--compact"');
    expect(source).toContain('<summary>Bead context</summary>');
    expect(source).toContain('className="beadsform-form-nav-row"');
  });
});
