import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('BeadsForm styles', () => {
  it('allows long BeadsForm pages to scroll inside the shell', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*height:\s*100vh[^}]*overflow-y:\s*auto/s);
  });

  it('keeps mobile BeadsForm submit actions above the safe-area bottom edge', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root\s*\{[^}]*padding:\s*2rem 2rem calc\(8rem \+ env\(safe-area-inset-bottom,\s*0px\)\)/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.beadsform-root\s*\{[^}]*padding:\s*1rem 1rem calc\(10rem \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
    expect(css).toMatch(/\.beadsform-root \.beads-form-submit-actions\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/s);
  });

  it('lays out single-question mode with desktop notes panel and mobile bottom notes', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-layout\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-notes\s*\{[^}]*position:\s*sticky/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.beadsform-root \.beadsform-single-question-layout\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.beadsform-root \.beadsform-single-question-notes\s*\{[^}]*position:\s*static/s);
  });
});
