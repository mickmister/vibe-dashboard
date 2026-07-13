import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BeadsForm styles', () => {
  it('allows long BeadsForm pages to scroll inside the shell', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*height:\s*100vh[^}]*overflow-y:\s*auto/s);
  });
});
