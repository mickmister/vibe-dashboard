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
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.beadsform-root \.beads-form-submit-actions\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*stretch[^}]*max-width:\s*100%/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.beadsform-root \.beads-form-submit-actions button\s*\{[^}]*box-sizing:\s*border-box[^}]*max-width:\s*100%[^}]*width:\s*100%[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('lays out single-question mode as a centered wide column with notes above the question', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root > header,\s*\.beadsform-root form,\s*\.beadsform-root section\s*\{[^}]*width:\s*100%[^}]*max-width:\s*72rem[^}]*margin-left:\s*auto[^}]*margin-right:\s*auto/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-form\s*\{[^}]*max-width:\s*80rem[^}]*margin:\s*0 auto/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-layout\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*max-width:\s*72rem[^}]*margin:\s*0\.85rem auto 1\.5rem/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-main\s*\{[^}]*max-width:\s*72rem[^}]*margin:\s*0 auto/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-controls--top\s*\{[^}]*margin-top:\s*0[^}]*margin-bottom:\s*1rem/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-notes\s*\{[^}]*display:\s*grid[^}]*position:\s*static[^}]*margin:\s*0 0 1rem/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-notes-toggle\s*\{[^}]*border-radius:\s*999px/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-master-notes\s*\{[^}]*display:\s*block/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-single-question-direct-submit\[hidden\]\s*\{[^}]*display:\s*none/s);
    expect(css).not.toContain('beadsform-single-question-progress-toggle');
    expect(css).not.toMatch(/\.beadsform-root \.beadsform-single-question-layout\s*\{[^}]*display:\s*grid/s);
    expect(css).not.toMatch(/\.beadsform-root \.beadsform-single-question-notes\s*\{[^}]*position:\s*sticky/s);
  });

  it('styles compact more-info toggles and hidden note textareas', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root \.beads-form-more-info-toggle\s*\{[^}]*border-radius:\s*999px/s);
    expect(css).toMatch(/\.beadsform-root \.beads-form-more-info-toggle\.has-value\s*\{[^}]*border-color:\s*#60a5fa/s);
    expect(css).toMatch(/\.beadsform-root \.beads-form-more-info-textarea\[hidden\]\s*\{[^}]*display:\s*none/s);
  });

  it('styles Markdown textarea preview controls as mobile-safe inline tabs', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root textarea\.beadsform-markdown-source-hidden\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-markdown-editor-toolbar\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-markdown-editor-tab\.is-active\s*\{[^}]*border-color:\s*#60a5fa/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-markdown-preview\s*\{[^}]*min-height:\s*8rem[^}]*border:\s*1px solid #3f3f46/s);
  });

  it('styles rich attachment and code snippet context blocks', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root \.beads-form-attachment-block,\s*\.beadsform-root \.beads-form-code-snippet\s*\{[^}]*display:\s*grid[^}]*border:\s*1px solid #3f3f46/s);
    expect(css).toMatch(/\.beadsform-root \.beads-form-attachment-link,\s*\.beadsform-root \.beads-form-code-snippet-link\s*\{[^}]*color:\s*#93c5fd/s);
    expect(css).toMatch(/\.beadsform-root \.beads-form-code-snippet-source\s*\{[^}]*color:\s*#d4d4d8/s);
  });

  it('styles BeadsForm loading states as centered cards', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root \.beadsform-loading-shell\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center[^}]*min-height:\s*min\(28rem,\s*70vh\)/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-loading-card\s*\{[^}]*width:\s*min\(100%,\s*32rem\)/s);
  });

  it('styles rendered recommendation reasons', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root \.beads-form-recommended-reason\s*\{[^}]*color:\s*#bbf7d0/s);
    expect(css).toMatch(/\.beadsform-root \.beads-form-recommended-reason-label\s*\{[^}]*font-weight:\s*700/s);
  });

  it('styles compact page chrome and polished Markdown description details', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root h1,\s*\.beadsform-root h2\s*\{[^}]*font-size:\s*clamp\(1\.5rem,\s*3vw,\s*2\.35rem\)/s);
    expect(css).toMatch(/\.beadsform-root \.beads-form-description-details > summary\s*\{[^}]*border-radius:\s*999px/s);
    expect(css).toMatch(/\.beadsform-root \.beads-form-description-details\[open\] \.beads-form-description-toggle-show,\s*\.beadsform-root \.beads-form-description-details:not\(\[open\]\) \.beads-form-description-toggle-hide\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-page-chrome--compact\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-all-forms-link\s*\{[^}]*white-space:\s*nowrap/s);
  });

  it('styles pending BeadsForm rows as compact mobile-safe inbox items', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.beadsform-root \.beadsform-pending-card\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-pending-title\s*\{[^}]*font-size:\s*1\.05rem/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-pending-meta\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.beadsform-root \.beadsform-pending-action\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.beadsform-root \.beadsform-pending-card\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*\.beadsform-root \.beadsform-pending-action\s*\{[^}]*min-height:\s*44px/s);
  });
});
